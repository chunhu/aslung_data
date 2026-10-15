"use client";
import React, { useState } from "react";
import { BellRing, Send, Settings, AlertTriangle, CheckCircle2, Clock, Mail, RefreshCw, ShieldAlert, Trash2, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { formatOfflineDuration } from "@/lib/utils";

export interface AlertSettings {
  id: number;
  enabled: number;
  check_interval_mins: number;
  offline_threshold_mins: number;
  use_test_email: number;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  last_check_at: string | null;
  last_alert_at: string | null;
  realtime_interval_secs?: number;
  schedule_type?: "interval" | "daily" | "weekly";
  schedule_time?: string;
  schedule_days?: string;
  timezone?: string;
}

export interface AlertCheck {
  id: number;
  check_type: string;
  total_devices: number;
  offline_count: number;
  notified_maintainers: number;
  status: string;
  summary: string;
  created_at: string;
}

export interface AlertLog {
  id: number;
  check_id?: number | null;
  aslung_id: string;
  lab_id: string;
  maintainer: string;
  email: string;
  last_seen: string | null;
  offline_mins: number;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface AlertsViewProps {
  alertSettings?: AlertSettings;
  alertChecks?: AlertCheck[];
  alertLogs: AlertLog[];
  selectedAlertChecks?: Set<number>;
  setSelectedAlertChecks?: React.Dispatch<React.SetStateAction<Set<number>>>;
  devices: Array<{ id: string; status: string; location: string }>;
  locations: Array<{ id: number; lab_id: string; aslung_id: string; maintainer?: string | null; active: number; end_time?: string | null }>;
  maintainers: Array<{ name: string; email: string; email_test: string }>;
  realtimeData: any[] | null;
  setModal: (m: string) => void;
  load: () => Promise<void>;
  localTime: (iso: string) => string;
  selectedAlertLogs?: Set<number>;
  setSelectedAlertLogs?: React.Dispatch<React.SetStateAction<Set<number>>>;
  setConfirmation?: (c: any) => void;
  admin?: boolean;
  me?: { email: string; name: string; role: string };
}

export default function AlertsView({
  alertSettings,
  alertChecks = [],
  alertLogs,
  devices,
  locations,
  maintainers,
  realtimeData,
  setModal,
  load,
  localTime,
  selectedAlertChecks,
  setSelectedAlertChecks,
  selectedAlertLogs,
  setSelectedAlertLogs,
  setConfirmation,
  admin = true,
  me,
}: AlertsViewProps) {
  const [checking, setChecking] = useState(false);
  const [selectedCheckDetail, setSelectedCheckDetail] = useState<AlertCheck | null>(null);
  const [localSelectedChecks, setLocalSelectedChecks] = useState<Set<number>>(new Set());
  const selectedChecks = selectedAlertChecks || localSelectedChecks;
  const setSelectedChecks = setSelectedAlertChecks || setLocalSelectedChecks;
  const [localSelectedLogs, setLocalSelectedLogs] = useState<Set<number>>(new Set());
  const selectedLogs = selectedAlertLogs || localSelectedLogs;
  const setSelectedLogs = setSelectedAlertLogs || setLocalSelectedLogs;

  const thresholdMins = alertSettings?.offline_threshold_mins || 60;
  const now = Date.now();

  // Find currently offline devices (只有使用中的設備才檢查)
  const activeLocMap = new Map<string, any>();
  for (const l of locations) {
    if (l.active === 1 && !l.end_time && !activeLocMap.has(l.aslung_id)) {
      activeLocMap.set(l.aslung_id, l);
    }
  }

  const myMaintainerName = (me?.name || "").trim();
  const myMaintainerNickname = ((me as any)?.nickname || "").trim();

  const inUseDevices = devices.filter((d) => {
    const isStatusOk = d.status === "DEPLOYED";
    if (!isStatusOk || !activeLocMap.has(d.id)) return false;
    if (admin) return true;
    const activeLoc = activeLocMap.get(d.id);
    const mName = (activeLoc?.maintainer || "").trim();
    return mName === myMaintainerName || (myMaintainerNickname && mName === myMaintainerNickname);
  });

  const offlineGroups = new Map<string, Array<{ aslung_id: string; lab_id: string; offline_mins: number; last_seen: string | null }>>();
  
  for (const d of inUseDevices) {
    const r = (realtimeData || []).find((x) => x.aslung_id === d.id);
    let offlineMins = 0;
    let lastSeen: string | null = null;
    if (!r) {
      offlineMins = 99999;
    } else {
      offlineMins = Math.floor((now - new Date(r.timestamp).getTime()) / 60000);
      lastSeen = r.timestamp;
    }

    if (offlineMins >= thresholdMins) {
      const activeLoc = activeLocMap.get(d.id);
      const labId = activeLoc?.lab_id || "未指定地點";
      const maintainer = (activeLoc?.maintainer || "未指定負責人").trim();

      const list = offlineGroups.get(maintainer) || [];
      list.push({ aslung_id: d.id, lab_id: labId, offline_mins: offlineMins, last_seen: lastSeen });
      offlineGroups.set(maintainer, list);
    }
  }

  const triggerCheckNow = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkNow" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "檢查失敗");
      await load();
      if (data.result?.skipped) {
        toast.info(data.result.skipReason || "本次檢查已略過");
        return;
      }
      if (data.result?.unknownCount) {
        toast.warning(`檢查完成：${data.result.offlineCount || 0} 台斷線，另有 ${data.result.unknownCount} 台查詢失敗，未計入斷線。請查看日誌。`);
        return;
      }
      toast.success(`檢查完成！共發現 ${data.result?.offlineCount || 0} 台斷線設備，已處理 ${data.result?.notifiedMaintainers || 0} 位維護者的通知。`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Status & Control Panel */}
      <section className="panel p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${alertSettings?.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                <span className={`w-2 h-2 rounded-full ${alertSettings?.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
                {alertSettings?.enabled ? "自動監控中" : "監控已暫停"}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {(() => {
                  const type = alertSettings?.schedule_type || "interval";
                  if (type === "daily") return `每天固定 ${alertSettings?.schedule_time || "09:00"} 檢查一次`;
                  if (type === "weekly") {
                    const dayLabels = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
                    const days = (alertSettings?.schedule_days || "1,2,3,4,5").split(",").map(s => dayLabels[parseInt(s.trim(), 10)]).filter(Boolean).join("、");
                    return `每週 (${days}) ${alertSettings?.schedule_time || "09:00"} 固定檢查`;
                  }
                  return `每 ${alertSettings?.check_interval_mins || 60} 分鐘自動檢查一次`;
                })()}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-800 mt-2">{admin ? "設備斷線告警監控中心" : "授權與列管設備斷線監控"}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {admin
                ? `當目前使用中的設備超過 ${thresholdMins} 分鐘未回報數據時，系統將自動彙整斷線設備清單並寄送通知信給指定負責人（已移出或報廢/維修之設備不納入告警）。`
                : `顯示您被授權存取與負責列管之使用中設備連線狀況（共 ${inUseDevices.length} 台）。設備超過 ${thresholdMins} 分鐘未回報即判定為斷線。`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {admin ? (
              <>
                <Button variant="default" disabled={checking} onClick={triggerCheckNow}>
                  <Send size={15} className={`mr-1.5 ${checking ? 'animate-spin' : ''}`} />
                  {checking ? "檢查中…" : "立即檢查並發送告警"}
                </Button>
                <Button variant="outline" onClick={() => setModal("alertSettings")}>
                  <Settings size={15} className="mr-1.5" />
                  自訂設定
                </Button>
              </>
            ) : (
              <Button variant="outline" disabled={checking} onClick={async () => { setChecking(true); try { await load(); toast.success("已更新監控狀態"); } finally { setChecking(false); } }}>
                <RefreshCw size={15} className={`mr-1.5 ${checking ? 'animate-spin' : ''}`} />
                重新整理狀態
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div className="p-3 bg-slate-50 rounded-lg border">
            <span className="text-slate-400 block mb-1">檢查排程</span>
            <span className="font-semibold text-slate-800 text-sm">
              {(() => {
                const type = alertSettings?.schedule_type || "interval";
                if (type === "daily") return `每日 ${alertSettings?.schedule_time || "09:00"}`;
                if (type === "weekly") {
                  const dayLabels = ["日", "一", "二", "三", "四", "五", "六"];
                  const days = (alertSettings?.schedule_days || "1,2,3,4,5").split(",").map(s => dayLabels[parseInt(s.trim(), 10)]).filter(Boolean).join("");
                  return `每週(${days}) ${alertSettings?.schedule_time || "09:00"}`;
                }
                return `每 ${alertSettings?.check_interval_mins || 60} 分鐘`;
              })()}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border">
            <span className="text-slate-400 block mb-1">斷線判定門檻</span>
            <span className="font-semibold text-slate-800 text-sm">超過 {thresholdMins} 分鐘</span>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border">
            <span className="text-slate-400 block mb-1">郵件發送通道</span>
            <span className="font-semibold text-slate-800 text-sm">
              {alertSettings?.smtp_host ? `SMTP: ${alertSettings.smtp_host}` : "模擬記錄模式 (未設定 SMTP)"}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border">
            <span className="text-slate-400 block mb-1">上次執行檢查時間</span>
            <span className="font-mono text-slate-700">
              {alertSettings?.last_check_at ? localTime(alertSettings.last_check_at) : "尚未執行"}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border">
            <span className="text-slate-400 block mb-1">上次告警發送時間</span>
            <span className="font-mono text-slate-700">
              {alertSettings?.last_alert_at ? localTime(alertSettings.last_alert_at) : "無告警紀錄"}
            </span>
          </div>
        </div>
      </section>

      {/* 2. Currently Offline Devices Grouped by Maintainer */}
      <section className="panel p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              目前斷線超過 {thresholdMins} 分鐘設備 ({Array.from(offlineGroups.values()).reduce((sum, list) => sum + list.length, 0)} 台)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">系統僅監控目前<strong>使用中</strong>之設備（共 {inUseDevices.length} 台），並依負責維護人員自動分組彙整。</p>
          </div>
        </div>

        {offlineGroups.size === 0 ? (
          <div className="py-8 text-center bg-emerald-50/50 rounded-lg border border-emerald-100 text-emerald-800 text-sm flex flex-col items-center gap-2">
            <CheckCircle2 size={32} className="text-emerald-500" />
            <p className="font-semibold">目前所有設備狀態皆正常連線中！</p>
            <p className="text-xs text-emerald-600">無任何設備斷線超過 {thresholdMins} 分鐘。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(admin
              ? Array.from(offlineGroups.entries())
              : Array.from(offlineGroups.entries()).filter(([mName]) => mName.trim() === myMaintainerName || (myMaintainerNickname && mName.trim() === myMaintainerNickname))
            ).map(([mName, items]) => {
              const mInfo = maintainers.find((x) => x.name.trim() === mName.trim());
              const targetEmail = mInfo ? (alertSettings?.use_test_email && mInfo.email_test ? mInfo.email_test : mInfo.email) : "尚未指定信箱";
              return (
                <div key={mName} className="border border-red-200 bg-red-50/30 rounded-lg p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-red-100 pb-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-red-200 text-red-800 flex items-center justify-center text-xs font-bold">
                          {mName.slice(0, 1)}
                        </div>
                        <span className="font-bold text-slate-900 text-sm">{mName}</span>
                        {mName.trim() === me?.name?.trim() && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">您的列管責任</span>
                        )}
                      </div>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                        {items.length} 台斷線
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mb-2 flex items-center gap-1 font-mono">
                      <Mail size={12} />
                      <span className="truncate" title={targetEmail}>{targetEmail}</span>
                    </div>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {items.map((it) => (
                        <div key={it.aslung_id} className="text-xs bg-white p-1.5 rounded border border-slate-200 flex items-center justify-between">
                          <span className="font-mono font-bold text-slate-800">{it.aslung_id}</span>
                          <span className="text-slate-500 truncate max-w-[100px]" title={it.lab_id}>{it.lab_id}</span>
                          <span className="text-red-600 font-semibold" title={it.last_seen ? `最後上傳：${localTime(it.last_seen)}（斷線約 ${it.offline_mins} 分鐘）` : "從未上傳數據"}>
                            {formatOfflineDuration(it.offline_mins, false, it.last_seen)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Check Execution Logs History (每次檢查為一筆) */}
      {(() => {
        const displayChecks: AlertCheck[] = (alertChecks && alertChecks.length > 0)
          ? alertChecks
          : (alertLogs.length > 0
              ? Array.from(new Set(alertLogs.map(l => l.created_at))).map((created_at, idx) => {
                  const matching = alertLogs.filter(l => l.created_at === created_at);
                  return {
                    id: idx + 1,
                    check_type: "SCHEDULED",
                    total_devices: matching.length,
                    offline_count: matching.length,
                    notified_maintainers: new Set(matching.map(l => l.maintainer)).size,
                    status: matching.some(l => l.status === "FAILED") ? "FAILED" : matching.some(l => l.status === "SIMULATED") ? "SIMULATED" : "SENT",
                    summary: "",
                    created_at,
                  };
                })
              : []);

        return (
          <section className="panel p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Clock size={16} />
                  檢查執行日誌 (以每次檢查為單位) <span className="text-xs font-normal text-slate-500 font-mono">({displayChecks.length} 次檢查)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">每次自動排程或手動檢查皆獨立記錄；點擊任一列日誌可展開查看斷線設備明細與告警信件發送狀況。</p>
              </div>
              <div className="flex gap-2">
                {admin && selectedChecks.size > 0 && setConfirmation && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setConfirmation({
                        action: "alertCheckDeleteBulk",
                        ids: Array.from(selectedChecks),
                        title: `刪除所選 ${selectedChecks.size} 筆檢查日誌？`,
                        description: `確認刪除所選的 ${selectedChecks.size} 筆檢查紀錄與其關聯的詳細設備紀錄？此操作無法復原。`,
                      });
                    }}
                  >
                    <Trash2 size={15} className="mr-1" />
                    大量刪除 ({selectedChecks.size})
                  </Button>
                )}
                {admin && displayChecks.length > 0 && setConfirmation && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => {
                      setConfirmation({
                        action: "alertCheckClearAll",
                        title: `清空全部檢查日誌？`,
                        description: `確認清空目前所有的 ${displayChecks.length} 筆檢查日誌與所有關聯明細？此操作無法復原。`,
                      });
                    }}
                  >
                    <Trash2 size={15} className="mr-1" />
                    清空全部日誌
                  </Button>
                )}
              </div>
            </div>

            {!displayChecks.length ? (
              <p className="text-xs text-slate-400 py-6 text-center">尚無任何檢查日誌記錄</p>
            ) : (
              <div className="table-scroll">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center font-semibold">序號</TableHead>
                      {admin && (
                        <TableHead className="w-10">
                          <input
                            type="checkbox"
                            checked={selectedChecks.size === displayChecks.length && displayChecks.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedChecks(new Set(displayChecks.map((c) => c.id)));
                              else setSelectedChecks(new Set());
                            }}
                          />
                        </TableHead>
                      )}
                      <TableHead>檢查時間</TableHead>
                      <TableHead>觸發方式</TableHead>
                      <TableHead>檢測總數</TableHead>
                      <TableHead>斷線設備</TableHead>
                      <TableHead>告警狀態</TableHead>
                      <TableHead>通知負責人</TableHead>
                      <TableHead className="text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayChecks.map((check, idx) => (
                      <TableRow
                        key={check.id}
                        className="cursor-pointer hover:bg-slate-50 transition-colors"
                        onClick={() => setSelectedCheckDetail(check)}
                      >
                        <TableCell className="text-center font-mono text-xs text-slate-500">{idx + 1}</TableCell>
                        {admin && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedChecks.has(check.id)}
                              onChange={(e) => {
                                const s = new Set(selectedChecks);
                                if (e.target.checked) s.add(check.id);
                                else s.delete(check.id);
                                setSelectedChecks(s);
                              }}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-xs font-medium">{localTime(check.created_at)}</TableCell>
                        <TableCell>
                          <span className={`text-[11px] px-2 py-0.5 rounded font-medium border ${check.check_type === "MANUAL" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-700 border-slate-200"}`}>
                            {check.check_type === "MANUAL" ? "手動立即檢查" : "自動定時排程"}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">
                          {check.total_devices > 0 ? `${check.total_devices} 台` : "—"}
                        </TableCell>
                        <TableCell>
                          {check.offline_count === 0 ? (
                            <span className="text-emerald-700 font-semibold inline-flex items-center gap-1 text-xs">
                              <CheckCircle2 size={13} /> {check.status === "FAILED" || check.status === "PENDING" ? "未確認斷線（請查看摘要）" : "全部正常 (0 台)"}
                            </span>
                          ) : (
                            <span className="text-red-600 font-bold font-mono inline-flex items-center gap-1 text-xs">
                              <AlertTriangle size={13} /> {check.offline_count} 台斷線
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {check.offline_count === 0 ? (
                            <span className="text-slate-400 text-xs">{check.status === "FAILED" ? "檢查異常" : check.status === "PENDING" ? "處理中" : "無須發送"}</span>
                          ) : (
                            <span className={`status ${check.status === 'SENT' ? 'ok' : check.status === 'SIMULATED' ? 'pending' : 'text-red-700 bg-red-100'}`}>
                              {check.status === 'SENT' ? '已寄出' : check.status === 'SIMULATED' ? '模擬記錄' : check.status === 'PENDING' ? '處理中' : '檢查或寄送失敗'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-slate-600">
                          {check.notified_maintainers > 0 ? `${check.notified_maintainers} 位` : "—"}
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2"
                              onClick={() => setSelectedCheckDetail(check)}
                            >
                              <Eye size={13} className="mr-1" />
                              詳細資料
                            </Button>
                            {admin && setConfirmation && (
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                title="刪除此筆檢查日誌"
                                onClick={() => {
                                  setConfirmation({
                                    action: "alertCheckDelete",
                                    id: check.id,
                                    title: "刪除此筆檢查日誌？",
                                    description: `確認刪除此筆檢查與其關聯的告警紀錄？此操作無法復原。`,
                                  });
                                }}
                              >
                                <Trash2 size={14} />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        );
      })()}

      {/* Detail Dialog: 點擊日誌後查看詳細告警資料 */}
      <Dialog open={!!selectedCheckDetail} onOpenChange={(v) => !v && setSelectedCheckDetail(null)}>
        <DialogContent className="bg-white sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock size={18} className="text-teal-600" />
              檢查執行詳細資料 #{selectedCheckDetail?.id}
            </DialogTitle>
            <DialogDescription>
              執行時間：{selectedCheckDetail ? localTime(selectedCheckDetail.created_at) : ""} · 觸發方式：{selectedCheckDetail?.check_type === "MANUAL" ? "手動立即檢查" : "自動定時排程"}
            </DialogDescription>
          </DialogHeader>

          {selectedCheckDetail && (() => {
            const filteredLogs = admin ? alertLogs : alertLogs.filter((l) => l.maintainer.trim() === myMaintainerName || (myMaintainerNickname && l.maintainer.trim() === myMaintainerNickname));
            const checkLogs = filteredLogs.filter(
              (l) => l.check_id === selectedCheckDetail.id || (!l.check_id && Math.abs(new Date(l.created_at).getTime() - new Date(selectedCheckDetail.created_at).getTime()) < 5000)
            );

            return (
              <div className="space-y-4 pt-1">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="bg-slate-50 p-2.5 rounded-lg border">
                    <span className="text-slate-400 block mb-0.5">檢測設備總數</span>
                    <span className="font-semibold text-slate-800 text-sm font-mono">{selectedCheckDetail.total_devices} 台</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border">
                    <span className="text-slate-400 block mb-0.5">斷線設備數</span>
                    <span className={`font-semibold text-sm font-mono ${selectedCheckDetail.offline_count > 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {selectedCheckDetail.offline_count} 台
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border">
                    <span className="text-slate-400 block mb-0.5">通知負責人</span>
                    <span className="font-semibold text-slate-800 text-sm font-mono">{selectedCheckDetail.notified_maintainers} 位</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border">
                    <span className="text-slate-400 block mb-0.5">整體狀態</span>
                    <span className="font-semibold text-slate-800 text-xs">
                      {selectedCheckDetail.status === "FAILED"
                        ? "檢查或寄送失敗，請查看摘要"
                        : selectedCheckDetail.status === "PENDING"
                        ? "處理中（中斷時可能有部分未寄送）"
                        : selectedCheckDetail.offline_count === 0
                        ? "全部正常連線"
                        : selectedCheckDetail.status === "SENT"
                        ? "已寄出通知信"
                        : selectedCheckDetail.status === "SIMULATED"
                        ? "模擬通知記錄"
                        : "寄送失敗"}
                    </span>
                  </div>
                </div>

                {checkLogs.length === 0 ? (
                  <div className="p-8 text-center bg-emerald-50/50 border border-emerald-200 rounded-lg">
                    <CheckCircle2 size={36} className="mx-auto text-emerald-600 mb-2" />
                    <h4 className="font-bold text-slate-800 text-sm">該次檢查所有使用中設備均正常連線</h4>
                    <p className="text-xs text-slate-500 mt-1">未發現超過斷線門檻之設備，未觸發告警通知信。</p>
                  </div>
                ) : (
                  <div>
                    <h4 className="text-xs font-bold text-slate-700 mb-2">斷線設備清單與告警通知明細 ({checkLogs.length} 筆)</h4>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="w-12 text-center font-semibold">序號</TableHead>
                            <TableHead>ASLUNG ID</TableHead>
                            <TableHead>地點 (Lab ID)</TableHead>
                            <TableHead>負責人</TableHead>
                            <TableHead>通知信箱</TableHead>
                            <TableHead>斷線時間</TableHead>
                            <TableHead>最後上傳時間</TableHead>
                            <TableHead>發送狀態</TableHead>
                            <TableHead>備註說明</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {checkLogs.map((log, idx) => (
                            <TableRow key={log.id}>
                              <TableCell className="text-center font-mono text-xs text-slate-500">{idx + 1}</TableCell>
                              <TableCell className="font-mono font-bold text-slate-800">{log.aslung_id}</TableCell>
                              <TableCell className="text-xs">{log.lab_id || "—"}</TableCell>
                              <TableCell className="font-medium">{log.maintainer}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-600">{log.email}</TableCell>
                              <TableCell className="text-xs text-red-600 font-semibold font-mono" title={log.status === "UNKNOWN" ? "查詢失敗，無法判定設備狀態" : log.last_seen ? `最後上傳：${localTime(log.last_seen)}（斷線約 ${log.offline_mins} 分鐘）` : "從未上傳數據"}>
                                {log.status === "UNKNOWN" ? "狀態未知" : formatOfflineDuration(log.offline_mins, false, log.last_seen)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-slate-500">
                                {log.status === "UNKNOWN" ? "查詢失敗" : log.last_seen ? localTime(log.last_seen) : "從未上傳"}
                              </TableCell>
                              <TableCell>
                                <span className={`status ${log.status === 'SENT' ? 'ok' : log.status === 'SIMULATED' ? 'pending' : 'text-red-700 bg-red-100'}`}>
                                  {log.status === 'SENT' ? '已寄出' : log.status === 'UNKNOWN' ? '未發送（狀態未知）' : log.status === 'SIMULATED' ? '模擬記錄' : '發送失敗'}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-slate-500 max-w-[160px] truncate" title={log.error_message || ''}>
                                {log.error_message || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
