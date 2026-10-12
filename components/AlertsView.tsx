"use client";
import React, { useState } from "react";
import { BellRing, Send, Settings, AlertTriangle, CheckCircle2, Clock, Mail, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "sonner";

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
}

export interface AlertLog {
  id: number;
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
  alertLogs: AlertLog[];
  devices: Array<{ id: string; status: string; location: string }>;
  locations: Array<{ id: number; lab_id: string; aslung_id: string; maintainer?: string | null; active: number }>;
  maintainers: Array<{ name: string; email: string; email_test: string }>;
  realtimeData: any[] | null;
  setModal: (m: string) => void;
  load: () => Promise<void>;
  localTime: (iso: string) => string;
  selectedAlertLogs?: Set<number>;
  setSelectedAlertLogs?: React.Dispatch<React.SetStateAction<Set<number>>>;
  setConfirmation?: (c: any) => void;
}

export default function AlertsView({
  alertSettings,
  alertLogs,
  devices,
  locations,
  maintainers,
  realtimeData,
  setModal,
  load,
  localTime,
  selectedAlertLogs,
  setSelectedAlertLogs,
  setConfirmation,
}: AlertsViewProps) {
  const [checking, setChecking] = useState(false);
  const [localSelectedLogs, setLocalSelectedLogs] = useState<Set<number>>(new Set());
  const selectedLogs = selectedAlertLogs || localSelectedLogs;
  const setSelectedLogs = setSelectedAlertLogs || setLocalSelectedLogs;

  const thresholdMins = alertSettings?.offline_threshold_mins || 60;
  const now = Date.now();

  // Find currently offline devices (只有使用中的設備才檢查)
  const activeLocMap = new Map<string, any>();
  for (const l of locations) {
    if (l.active === 1 && !activeLocMap.has(l.aslung_id)) {
      activeLocMap.set(l.aslung_id, l);
    }
  }

  const inUseDevices = devices.filter((d) => {
    const isStatusOk = d.status === "DEPLOYED" || !d.status || (d.status !== "RETIRED" && d.status !== "MAINTENANCE" && d.status !== "LOST");
    return isStatusOk && activeLocMap.has(d.id);
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
                每 {alertSettings?.check_interval_mins || 60} 分鐘自動檢查一次
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-800 mt-2">設備斷線告警監控中心</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              當目前<strong>使用中</strong>的設備超過 <strong>{thresholdMins} 分鐘</strong> 未回報數據時，系統將自動彙整斷線設備清單並寄送通知信給指定負責人（已移出或報廢/維修之設備不納入告警）。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" disabled={checking} onClick={triggerCheckNow}>
              <Send size={15} className={`mr-1.5 ${checking ? 'animate-spin' : ''}`} />
              {checking ? "檢查中…" : "立即檢查並發送告警"}
            </Button>
            <Button variant="outline" onClick={() => setModal("alertSettings")}>
              <Settings size={15} className="mr-1.5" />
              自訂設定
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
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
            {Array.from(offlineGroups.entries()).map(([mName, items]) => {
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
                          <span className="text-red-600 font-semibold">
                            {it.offline_mins === 99999 ? '>7天' : `${Math.floor(it.offline_mins / 60)}小時${it.offline_mins % 60}分`}
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

      {/* 3. Alert Logs History */}
      <section className="panel p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Clock size={16} />
              最近告警通知發送日誌 <span className="text-xs font-normal text-slate-500 font-mono">({alertLogs.length} 筆)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">顯示各設備斷線時觸發的郵件發送紀錄與狀態。</p>
          </div>
          <div className="flex gap-2">
            {selectedLogs.size > 0 && setConfirmation && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirmation({
                    action: "alertLogDeleteBulk",
                    ids: Array.from(selectedLogs),
                    title: `刪除所選 ${selectedLogs.size} 筆告警日誌？`,
                    description: `確認刪除所選的 ${selectedLogs.size} 筆告警發送紀錄？此操作無法復原。`,
                  });
                }}
              >
                <Trash2 size={15} className="mr-1" />
                大量刪除 ({selectedLogs.size})
              </Button>
            )}
            {alertLogs.length > 0 && setConfirmation && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => {
                  setConfirmation({
                    action: "alertLogClearAll",
                    title: `清空全部告警日誌？`,
                    description: `確認清空目前所有的 ${alertLogs.length} 筆告警發送紀錄？此操作無法復原。`,
                  });
                }}
              >
                <Trash2 size={15} className="mr-1" />
                清空全部日誌
              </Button>
            )}
          </div>
        </div>

        {!alertLogs.length ? (
          <p className="text-xs text-slate-400 py-6 text-center">尚無任何告警日誌記錄</p>
        ) : (
          <div className="table-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center font-semibold">序號</TableHead>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedLogs.size === alertLogs.length && alertLogs.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedLogs(new Set(alertLogs.map((l) => l.id)));
                        else setSelectedLogs(new Set());
                      }}
                    />
                  </TableHead>
                  <TableHead>發送時間</TableHead>
                  <TableHead>ASLUNG ID</TableHead>
                  <TableHead>地點 (Lab ID)</TableHead>
                  <TableHead>負責人</TableHead>
                  <TableHead>通知信箱</TableHead>
                  <TableHead>斷線時長</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>詳細說明</TableHead>
                  <TableHead className="text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertLogs.map((log, idx) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-center font-mono text-xs text-slate-500">{idx + 1}</TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedLogs.has(log.id)}
                        onChange={(e) => {
                          const s = new Set(selectedLogs);
                          if (e.target.checked) s.add(log.id);
                          else s.delete(log.id);
                          setSelectedLogs(s);
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{localTime(log.created_at)}</TableCell>
                    <TableCell className="font-mono font-semibold">{log.aslung_id}</TableCell>
                    <TableCell className="text-xs">{log.lab_id || "—"}</TableCell>
                    <TableCell className="font-medium">{log.maintainer}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{log.email}</TableCell>
                    <TableCell className="text-xs text-red-600 font-semibold font-mono">
                      {log.offline_mins === 99999 ? '超過7天' : `${log.offline_mins} 分鐘`}
                    </TableCell>
                    <TableCell>
                      <span className={`status ${log.status === 'SENT' ? 'ok' : log.status === 'SIMULATED' ? 'pending' : 'text-red-700 bg-red-100'}`}>
                        {log.status === 'SENT' ? '已寄出' : log.status === 'SIMULATED' ? '模擬記錄' : '發送失敗'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate" title={log.error_message || ''}>
                      {log.error_message || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {setConfirmation && (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          title="刪除此筆日誌"
                          onClick={() => {
                            setConfirmation({
                              action: "alertLogDelete",
                              id: log.id,
                              title: "刪除此筆告警日誌？",
                              description: `確認刪除此筆 ${log.aslung_id} 的告警發送紀錄？此操作無法復原。`,
                            });
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
