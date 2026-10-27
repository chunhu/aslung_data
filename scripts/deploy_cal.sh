#!/usr/bin/env bash
# Deploy the calibration branch on the existing Ubuntu EC2 Docker installation.
# Load functions before switching Git refs: Git may replace this script on disk.
set -Eeuo pipefail

TARGET_BRANCH='codex/calibration-management'
CURRENT_STAGE='初始化'
DEPLOY_STARTED_AT=$(date +%s)
STAGE_NAMES=()
STAGE_SECONDS=()
APP_UPDATE_STARTED=0
WORKER_STOPPED=0

on_error() {
    local exit_code=$1
    trap - ERR
    printf '\n部署失敗：%s（結束碼 %s）\n' "$CURRENT_STAGE" "$exit_code" >&2
    echo '請查看上方錯誤。本腳本不會自動回復資料庫或刪除資料磁碟區。' >&2
    if [[ "$APP_UPDATE_STARTED" -eq 0 ]]; then
        echo '尚未執行網站容器更新；既有網站未被本腳本停止。' >&2
    fi
    if [[ "$WORKER_STOPPED" -eq 1 ]]; then
        echo '校正 worker 已停止。修正錯誤並重新執行本腳本，以完成部署。' >&2
    fi
    echo "已耗時：$(($(date +%s) - DEPLOY_STARTED_AT)) 秒。" >&2
    exit "$exit_code"
}
trap 'on_error "$?"' ERR

run_stage() {
    CURRENT_STAGE=$1
    shift
    local started elapsed
    started=$(date +%s)
    printf '\n--- %s ---\n' "$CURRENT_STAGE"
    "$@"
    elapsed=$(($(date +%s) - started))
    STAGE_NAMES+=("$CURRENT_STAGE")
    STAGE_SECONDS+=("$elapsed")
    printf '[階段耗時] %s：%s 秒\n' "$CURRENT_STAGE" "$elapsed"
}

die() { echo "$*" >&2; return 1; }

check_worktree() {
    "${GIT[@]}" diff --quiet || die '有尚未提交的程式修改，請先提交或自行保留後再部署；不會自動覆寫或 stash。'
    "${GIT[@]}" diff --cached --quiet || die 'Git 暫存區有待提交修改，請先處理後再部署。'
    local path
    while IFS= read -r -d '' path; do
        # Allows copying this script onto an older checkout before the first run.
        [[ "$path" == 'scripts/deploy_cal.sh' ]] || die "有未追蹤檔案：$path；請先處理，避免分支切換覆寫。"
    done < <("${GIT[@]}" ls-files --others --exclude-standard -z)
}

update_branch() {
    "${GIT[@]}" fetch origin "refs/heads/$TARGET_BRANCH:refs/remotes/origin/$TARGET_BRANCH"
    if "${GIT[@]}" show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
        "${GIT[@]}" switch "$TARGET_BRANCH"
    else
        "${GIT[@]}" switch --track -c "$TARGET_BRANCH" "origin/$TARGET_BRANCH"
    fi
    "${GIT[@]}" merge-base --is-ancestor HEAD "origin/$TARGET_BRANCH" || die '本機分支有未推送提交或與遠端分歧，請先處理；不會 reset 或強制合併。'
    "${GIT[@]}" merge --ff-only "origin/$TARGET_BRANCH"
    DEPLOY_COMMIT=$("${GIT[@]}" rev-parse HEAD)
    [[ "$DEPLOY_COMMIT" == "$("${GIT[@]}" rev-parse "origin/$TARGET_BRANCH")" ]] || die '本機版本與遠端不一致，停止部署。'
    [[ -f compose.yaml && -f scripts/calibration-worker.mjs && -f lib/processing-jobs.mjs ]] || die '分支缺少校正部署所需檔案。'
    echo "部署分支：$TARGET_BRANCH"
    echo "部署提交：$DEPLOY_COMMIT"
}

stop_worker() {
    # Website remains available while building and backing up.
    "${COMPOSE[@]}" stop -t 120 calibration-worker
    WORKER_STOPPED=1
}

backup_database() {
    # Use the new image's runtime and the production volumes, but never import store.mjs.
    # Opening SQLite directly in read-only mode avoids running new schema migrations.
    "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint node app --input-type=module - <<'NODE'
import {DatabaseSync,backup} from 'node:sqlite';
import {access,mkdir,chmod} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
const database=resolve(process.env.DATABASE_PATH||'./data/aslung.sqlite');
const directory=resolve(process.env.BACKUP_PATH||'./backups');
const results=resolve(process.env.CALIBRATION_RESULT_DIR||join(dirname(database),'calibration-results'));
if(!database.startsWith('/app/data/')||(!directory.startsWith('/app/backups/')&&directory!=='/app/backups')||!results.startsWith('/app/data/'))
  throw new Error('DATABASE_PATH／BACKUP_PATH／CALIBRATION_RESULT_DIR 必須位於 Compose 持久磁碟區 /app/data、/app/backups 內，請先修正 .env 或掛載設定。');
for(const key of ['MYSQL_HOST','MYSQL_USER','MYSQL_DATABASE'])if(!process.env[key])throw new Error('缺少必要環境設定：'+key);
try{await access(database);}catch{throw new Error('找不到既有正式資料庫，停止部署以避免意外建立空資料庫。請確認 DATABASE_PATH 與 Compose 專案／磁碟區。');}
await mkdir(directory,{recursive:true,mode:0o700});
const filename=join(directory,'before-cal-'+new Date().toISOString().replaceAll(':','-')+'.sqlite');
const source=new DatabaseSync(database,{readOnly:true});
try{await backup(source,filename);}finally{source.close();}
await chmod(filename,0o600);
const check=new DatabaseSync(filename,{readOnly:true});
try{
  const integrity=check.prepare('PRAGMA integrity_check').get();
  if(Object.values(integrity)[0]!=='ok')throw new Error('備份完整性檢查失敗，停止部署。');
}finally{check.close();}
console.log('升級前資料庫備份完成：'+filename);
NODE
}

start_website() {
    APP_UPDATE_STARTED=1
    "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180 app
}

start_worker() {
    # Verify with one short-lived connection while the old worker is still stopped.
    "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint node calibration-worker scripts/check-calibration-mysql.mjs
    "${COMPOSE[@]}" up -d --no-build --force-recreate calibration-worker
    WORKER_STOPPED=0
    local container state attempt
    container=$("${COMPOSE[@]}" ps -q calibration-worker)
    [[ -n "$container" ]] || die '校正 worker 容器未執行。'
    for attempt in 1 2 3; do
        sleep 2
        state=$("${DOCKER[@]}" inspect --format '{{.State.Running}} {{.RestartCount}}' "$container")
        [[ "$state" == 'true 0' ]] || die '校正 worker 未穩定執行；請查看 docker compose --profile calibration logs --tail=80 calibration-worker。'
    done
    WORKER_STOPPED=0
}

main() {
    local no_cache=0 argument command_name lock_directory
    for argument in "$@"; do
        case "$argument" in
            --no-cache) no_cache=1 ;;
            -h|--help)
                echo '用法：bash scripts/deploy_cal.sh [--no-cache]'
                echo "部署 $TARGET_BRANCH，備份既有 SQLite，並啟動網站與校正 worker。"
                echo '預設使用 Docker 建置快取；即使 Git 無更新仍檢查並部署兩項服務。'
                return 0 ;;
            *) echo "不支援的參數：$argument" >&2; return 2 ;;
        esac
    done
    cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
    for command_name in git docker flock systemctl; do
        command -v "$command_name" >/dev/null || die "缺少必要指令：$command_name；此腳本適用 Ubuntu EC2。"
    done
    GIT=(git -c "safe.directory=$PWD")
    DOCKER=(docker)
    if [[ "$EUID" -ne 0 ]]; then
        command -v sudo >/dev/null || die '缺少 sudo。'
        sudo -v
        DOCKER=(sudo docker)
    fi
    [[ -f .env ]] || die '缺少專案 .env，請先設定正式環境變數。'
    "${GIT[@]}" rev-parse --show-toplevel >/dev/null
    lock_directory=$("${GIT[@]}" rev-parse --git-common-dir)
    exec 9>"$lock_directory/deploy-cal.lock"
    flock -n 9 || die '另一個校正部署正在執行，請等待完成。'
    COMPOSE=("${DOCKER[@]}" compose --profile calibration)
    run_stage '檢查本機未提交修改' check_worktree
    run_stage '更新校正分支（僅 fast-forward）' update_branch
    run_stage '設定開機自動啟動' bash scripts/setup-autostart.sh --services-only
    run_stage '檢查 Docker Compose 設定' "${COMPOSE[@]}" config --quiet
    local build_options=()
    if [[ "$no_cache" -eq 1 ]]; then build_options+=(--no-cache); fi
    run_stage '建置網站與校正 worker 映像' "${COMPOSE[@]}" --progress plain build "${build_options[@]}" app calibration-worker
    run_stage '檢查校正成果儲存設定與 S3 讀寫' "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint node app scripts/check-calibration-s3.mjs
    run_stage '暫停校正 worker' stop_worker
    run_stage '升級前備份與完整性檢查' backup_database
    run_stage '更新網站並等待健康檢查' start_website
    run_stage '啟動校正 worker 並驗證' start_worker
    "${COMPOSE[@]}" ps app calibration-worker
    printf '\n部署完成：%s @ %s\n' "$TARGET_BRANCH" "$DEPLOY_COMMIT"
    local index
    for index in "${!STAGE_NAMES[@]}"; do printf '  %s：%s 秒\n' "${STAGE_NAMES[$index]}" "${STAGE_SECONDS[$index]}"; done
    echo "總耗時：$(($(date +%s) - DEPLOY_STARTED_AT)) 秒"
    echo '開機後網站與 worker 依 restart: unless-stopped 恢復。'
    echo '全域／單台校正排程沿用資料庫中的設定；本腳本不會自動開啟排程。'
}

main "$@"
