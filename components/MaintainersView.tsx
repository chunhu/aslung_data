"use client";
import React from "react";
import MaintainerName from "@/components/MaintainerName";
import { UserCheck, CloudDownload, Plus, Trash2, Pencil, Mail, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";

export interface Maintainer {
  name: string;
  english_name?: string;
  email: string;
  email_test: string;
  phone: string;
  notes: string;
  created_at: string;
}

interface MaintainersViewProps {
  maintainers: Maintainer[];
  devices: Array<{ id: string; status: string; location: string }>;
  locations: Array<{ id: number; lab_id: string; aslung_id: string; maintainer?: string | null; active: number; end_time?: string | null }>;
  realtimeData: any[] | null;
  search: string;
  setSearch: (s: string) => void;
  selectedMaintainers: Set<string>;
  setSelectedMaintainers: React.Dispatch<React.SetStateAction<Set<string>>>;
  setEditMaintainer: (m: Maintainer | null) => void;
  setModal: (m: string) => void;
  setConfirmation: (c: any) => void;
}

export default function MaintainersView({
  maintainers,
  devices,
  locations,
  realtimeData,
  search,
  setSearch,
  selectedMaintainers,
  setSelectedMaintainers,
  setEditMaintainer,
  setModal,
  setConfirmation,
}: MaintainersViewProps) {
  const filtered = maintainers.filter((m) =>
    (m.name + " " + (m.english_name||"") + " " + m.email + " " + (m.email_test || "") + " " + (m.phone || "") + " " + (m.notes || "")).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="panel">
      <div className="list-heading">
        <div className="flex items-center gap-4">
          <h2>
            維護人員名單 <span className="count">{maintainers.length}</span>
          </h2>
          <Input
            className="w-64 h-9 bg-white"
            placeholder="搜尋姓名、Email 或備註..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {selectedMaintainers.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmation({
                  action: "maintainerDeleteBulk",
                  names: Array.from(selectedMaintainers),
                  title: `刪除所選 ${selectedMaintainers.size} 位維護人員？`,
                  description: `確認刪除所選的 ${selectedMaintainers.size} 位維護人員？設備追蹤紀錄仍會保留文字紀錄。`,
                });
              }}
            >
              <Trash2 size={16} className="mr-1" />
              大量刪除 ({selectedMaintainers.size})
            </Button>
          )}
          <Button variant="secondary" onClick={() => setModal("maintainerSync")}>
            <CloudDownload size={16} className="mr-1" />
            同步 Google 試算表
          </Button>
          <Button
            onClick={() => {
              setEditMaintainer(null);
              setModal("maintainer");
            }}
          >
            <Plus size={16} />
            新增維護人員
          </Button>
        </div>
      </div>

      {!filtered.length ? (
        <Empty className="empty-area">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserCheck />
            </EmptyMedia>
            <EmptyTitle>{search ? "沒有符合的維護人員" : "尚無維護人員資料"}</EmptyTitle>
            <EmptyDescription className="text-sm">
              {search ? "請嘗試其他關鍵字。" : "點擊「同步 Google 試算表」匯入 12 位維護人員名冊，或點擊「新增維護人員」獨立建立。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="table-scroll">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center font-semibold">序號</TableHead>
                <TableHead>
                  <input
                    type="checkbox"
                    checked={selectedMaintainers.size === filtered.length && filtered.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedMaintainers(new Set(filtered.map((m) => m.name)));
                      else setSelectedMaintainers(new Set());
                    }}
                  />
                </TableHead>
                <TableHead>維護者姓名</TableHead>
                <TableHead>主要通知 Email (mail)</TableHead>
                <TableHead>測試信箱 (mail_test)</TableHead>
                <TableHead>聯絡電話</TableHead>
                <TableHead className="text-center">負責設備</TableHead>
                <TableHead className="text-center">斷線設備 (&gt;60分)</TableHead>
                <TableHead>備註說明</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m, idx) => {
                // Find all active devices managed by this maintainer (只有使用中的設備才檢查)
                const activeLocs = locations.filter((loc) => loc.active === 1 && !loc.end_time && loc.maintainer?.trim() === m.name.trim());
                const assignedDeviceIds = Array.from(new Set(activeLocs.map((l) => l.aslung_id))).filter((devId) => {
                  const dev = devices.find((x) => x.id === devId);
                  return !dev || dev.status === "DEPLOYED";
                });
                
                // Count offline devices among assigned
                const now = Date.now();
                const offlineDevices = assignedDeviceIds.filter((devId) => {
                  const r = (realtimeData || []).find((x) => x.aslung_id === devId);
                  if (!r) return true;
                  return now - new Date(r.timestamp).getTime() > 3600000;
                });

                return (
                  <TableRow key={m.name}>
                    <TableCell className="text-center font-mono text-xs text-slate-500">{idx + 1}</TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedMaintainers.has(m.name)}
                        onChange={(e) => {
                          const s = new Set(selectedMaintainers);
                          if (e.target.checked) s.add(m.name);
                          else s.delete(m.name);
                          setSelectedMaintainers(s);
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-semibold text-slate-900">
                      <MaintainerName name={m.name}/>
                    </TableCell>
                    <TableCell>
                      <a href={`mailto:${m.email}`} className="text-blue-600 hover:underline flex items-center gap-1 font-mono text-xs">
                        <Mail size={13} className="text-slate-400" />
                        {m.email}
                      </a>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {m.email_test ? (
                        <span title="測試告警發送信箱">{m.email_test}</span>
                      ) : (
                        <span className="text-slate-400">同主要信箱</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">{m.phone || <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {assignedDeviceIds.length > 0 ? (
                        <span className="font-semibold text-slate-800">{assignedDeviceIds.length} 台</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {offlineDevices.length > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold" title={`斷線設備：${offlineDevices.join(", ")}`}>
                          <AlertTriangle size={12} />
                          {offlineDevices.length} 台
                        </span>
                      ) : assignedDeviceIds.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                          <CheckCircle2 size={12} /> 全數在線
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate" title={m.notes || ''}>
                      {m.notes || <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditMaintainer(m);
                            setModal("maintainer");
                          }}
                        >
                          <Pencil size={13} className="mr-1" />
                          編輯
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => {
                            setConfirmation({
                              action: "maintainerDelete",
                              name: m.name,
                              title: `刪除維護人員「${m.name}」？`,
                              description: "確認刪除此維護人員資料？",
                            });
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
