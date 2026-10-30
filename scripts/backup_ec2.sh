#!/usr/bin/env bash
# Consistent local application backup. Never source .env or migrate the database.
set -Eeuo pipefail
umask 077

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
OUTPUT="$(dirname -- "$ROOT")/aslung-backups"
SAVE_IMAGES=1
STAGE='初始化'
RESUME_APP=0
RESUME_WORKER=0
DEST=''
APP_ID=''
WORKER_ID=''

usage() {
    cat <<'HELP'
用法：sudo bash scripts/backup_ec2.sh [--output /absolute/backup-directory] [--skip-images]
建立帶時間戳記的獨立目錄，備份 SQLite、/app/data 全部檔案、設定、Git 版本及容器映像。
網站與原本運行的 worker 會短暫停止；成功或失敗均嘗試恢復原本運行的容器。
--skip-images  不匯出 Docker 映像，以節省空間（回退時需另有映像或重新建置）。
不包含遠端 MySQL、S3、EC2 主機設定、既有備份磁碟區或外部憑證檔。
不更新 Git、不建立／刪除容器、不刪除磁碟區、不自動刪除舊備份。
HELP
}
die() { echo "$*" >&2; exit 1; }
resume() {
    local failed=0
    if [[ "$RESUME_APP" -eq 1 ]]; then
        if docker start "$APP_ID" >/dev/null && [[ "$(docker inspect --format '{{.State.Running}}' "$APP_ID")" == true ]]; then RESUME_APP=0; else failed=1; fi
    fi
    if [[ "$RESUME_WORKER" -eq 1 ]]; then
        if docker start "$WORKER_ID" >/dev/null && [[ "$(docker inspect --format '{{.State.Running}}' "$WORKER_ID")" == true ]]; then RESUME_WORKER=0; else failed=1; fi
    fi
    return "$failed"
}
finish() {
    local code=$?
    trap - EXIT
    if ! resume; then
        echo '容器恢復失敗，請執行 docker compose --profile calibration ps -a 並檢查狀態。' >&2
        code=1
    fi
    if [[ "$code" -ne 0 ]]; then
        if [[ -n "$DEST" ]]; then rm -f -- "$DEST/COMPLETE" || true; fi
        printf '\n備份未完成：%s。已嘗試恢復原先運行的容器。\n' "$STAGE" >&2
        [[ -z "$DEST" ]] || echo "未完成檔案保留於：$DEST（不會有 COMPLETE 標記）。" >&2
    fi
    exit "$code"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h) usage; exit 0 ;;
        --output) [[ $# -ge 2 && "$2" == /* ]] || die '--output 需要絕對路徑。'; OUTPUT=$2; shift 2 ;;
        --skip-images) SAVE_IMAGES=0; shift ;;
        *) die "不支援的參數：$1" ;;
    esac
done
for command_name in docker git flock tar gzip sha256sum realpath; do
    command -v "$command_name" >/dev/null || die "缺少 $command_name；請在 EC2 Ubuntu 執行。"
done
cd -- "$ROOT"
[[ -f compose.yaml && -f .env ]] || die '找不到 compose.yaml 或 .env。'
GIT=(git -c "safe.directory=$ROOT")
LOCK_DIR=$("${GIT[@]}" rev-parse --git-common-dir)
exec 9>"$LOCK_DIR/deploy-cal.lock"
flock -n 9 || die '備份或部署正在執行，請稍後再試。'
COMPOSE=(docker compose --profile calibration)
"${COMPOSE[@]}" config --quiet
APP_ID=$("${COMPOSE[@]}" ps -a -q app)
WORKER_ID=$("${COMPOSE[@]}" ps -a -q calibration-worker)
[[ -n "$APP_ID" && "$APP_ID" != *$'\n'* ]] || die '需要現有且唯一的 app 容器。'
[[ "$WORKER_ID" != *$'\n'* ]] || die '不支援多個 worker 容器。'
[[ "$(docker inspect --format '{{.State.Running}}' "$APP_ID")" == true ]] || die '請先啟動現有網站，再執行備份。'
APP_IMAGE=$(docker inspect --format '{{.Image}}' "$APP_ID")
WORKER_IMAGE=''
if [[ -n "$WORKER_ID" ]]; then WORKER_IMAGE=$(docker inspect --format '{{.Image}}' "$WORKER_ID"); fi

# Read only paths from the live runtime. No secrets or application imports.
DATABASE=$(docker exec -i "$APP_ID" node --input-type=module - <<'NODE'
import {resolve,dirname,join} from 'node:path';
const db=resolve(process.env.DATABASE_PATH||'/app/data/aslung.sqlite');
const results=resolve(process.env.CALIBRATION_RESULT_DIR||join(dirname(db),'calibration-results'));
if(!db.startsWith('/app/data/')||!results.startsWith('/app/data/'))throw new Error('資料庫及本機成果必須位於 /app/data 持久磁碟區。');
console.log(db);
NODE
)
[[ "$DATABASE" == /app/data/* && "$DATABASE" != *$'\n'* ]] || die '無法確認資料庫路徑。'
OUTPUT=$(realpath -m -- "$OUTPUT")
[[ "$OUTPUT/" != "$ROOT/"* && "$OUTPUT" != *','* ]] || die '備份目錄須在專案外，且不可包含逗號。'
if [[ ! -d "$OUTPUT" ]]; then
    [[ -d "$(dirname -- "$OUTPUT")" ]] || die '備份上層目錄不存在，請先建立或掛載備份磁碟。'
    mkdir -- "$OUTPUT"
    if [[ "$EUID" -eq 0 && -n "${SUDO_UID:-}" && -n "${SUDO_GID:-}" ]]; then chown "$SUDO_UID:$SUDO_GID" "$OUTPUT"; fi
fi
DEST="$OUTPUT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -- "$DEST"
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

STAGE='保存設定、原始碼與版本資訊'
echo "備份目錄：$DEST"
echo '備份包含設定密鑰，請妥善保管。大型成果與映像需要足夠磁碟空間。'
cp -- .env compose.yaml "$DEST/"
"${GIT[@]}" rev-parse HEAD > "$DEST/git-commit.txt"
"${GIT[@]}" status --short > "$DEST/git-status.txt"
"${GIT[@]}" diff HEAD --binary > "$DEST/working-tree.patch"
"${GIT[@]}" archive --format=tar HEAD | gzip > "$DEST/source-code.tar.gz"
printf 'app=%s\ncalibration-worker=%s\n' "$APP_IMAGE" "$WORKER_IMAGE" > "$DEST/images.txt"

if [[ "$SAVE_IMAGES" -eq 1 ]]; then
    STAGE='匯出目前容器映像（網站仍運行）'
    IMAGES=("$APP_IMAGE")
    if [[ -n "$WORKER_IMAGE" && "$WORKER_IMAGE" != "$APP_IMAGE" ]]; then IMAGES+=("$WORKER_IMAGE"); fi
    docker image save "${IMAGES[@]}" | gzip > "$DEST/docker-images.tar.gz"
fi

STAGE='停止寫入服務'
if [[ -n "$WORKER_ID" && "$(docker inspect --format '{{.State.Running}}' "$WORKER_ID")" == true ]]; then
    RESUME_WORKER=1
    docker stop -t 120 "$WORKER_ID" >/dev/null
fi
RESUME_APP=1
docker stop -t 120 "$APP_ID" >/dev/null

STAGE='備份 SQLite 與 /app/data'
# Use the actual running image, not the newly checked-out source or a mutable tag.
# The helper has no network and only read-only access to production volumes.
docker run --rm -i --network none --user 0:0 \
    --volumes-from "$APP_ID:ro" \
    --mount "type=bind,src=$DEST,dst=/backup" \
    -e BACKUP_DATABASE="$DATABASE" --entrypoint node "$APP_IMAGE" --input-type=module - <<'NODE'
import {DatabaseSync,backup} from 'node:sqlite';
import {chmodSync,writeFileSync} from 'node:fs';
const source=new DatabaseSync(process.env.BACKUP_DATABASE,{readOnly:true});
try{await backup(source,'/backup/aslung.sqlite');}finally{source.close();}
const check=new DatabaseSync('/backup/aslung.sqlite',{readOnly:true});
try{for(const row of check.prepare('PRAGMA integrity_check').all())if(Object.values(row)[0]!=='ok')throw new Error('SQLite 完整性檢查失敗');}finally{check.close();}
chmodSync('/backup/aslung.sqlite',0o600);
writeFileSync('/backup/database-path.txt',process.env.BACKUP_DATABASE+'\n',{mode:0o600});
console.log('SQLite 備份完整性檢查通過。');
NODE
docker run --rm --network none --user 0:0 --volumes-from "$APP_ID:ro" \
    --entrypoint tar "$APP_IMAGE" -czf - -C /app/data . > "$DEST/app-data.tar.gz"

STAGE='恢復服務'
resume

STAGE='驗證封存檔與校驗碼'
gzip -t "$DEST/source-code.tar.gz" "$DEST/app-data.tar.gz"
tar -tzf "$DEST/source-code.tar.gz" >/dev/null
tar -tzf "$DEST/app-data.tar.gz" >/dev/null
if [[ "$SAVE_IMAGES" -eq 1 ]]; then gzip -t "$DEST/docker-images.tar.gz"; tar -tzf "$DEST/docker-images.tar.gz" >/dev/null; fi
cat > "$DEST/BACKUP-INFO.txt" <<EOF
UTC: $(date -u +%FT%TZ)
Scope: consistent SQLite + all /app/data files + .env + compose.yaml + Git HEAD archive + tracked working-tree patch.
Docker images included: $SAVE_IMAGES (actual container image IDs are in images.txt).
Not included: remote MySQL, S3 objects, host configuration, external credential files, untracked/ignored source files, prior backups volume.
Restore app-data and SQLite together while writers are stopped; never restore only SQLite after deleting associated files.
The checkout commit may differ from deployed code: images.txt identifies the deployed runtime.
EOF
(
    cd -- "$DEST"
    sha256sum .env compose.yaml git-commit.txt git-status.txt working-tree.patch source-code.tar.gz images.txt aslung.sqlite database-path.txt app-data.tar.gz BACKUP-INFO.txt > SHA256SUMS
    if [[ "$SAVE_IMAGES" -eq 1 ]]; then sha256sum docker-images.tar.gz >> SHA256SUMS; fi
    sha256sum --check SHA256SUMS
)
STAGE='完成'
touch "$DEST/COMPLETE"
chmod 700 "$DEST"
chmod 600 "$DEST"/* "$DEST/.env"
if [[ "$EUID" -eq 0 && -n "${SUDO_UID:-}" && -n "${SUDO_GID:-}" ]]; then chown -R "$SUDO_UID:$SUDO_GID" "$DEST"; fi
echo "備份完成：$DEST"
echo '已恢復原先運行的容器。請另存一份備份到其他電腦或受保護的儲存空間。'
