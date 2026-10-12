"use client";
import React from "react";
import { Building2, CloudDownload, Plus, Trash2, Pencil, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";

export interface Lab {
  id: string;
  city_name: string;
  town_name: string;
  location_name: string;
  lat: number | null;
  lon: number | null;
  description: string;
  height: string;
  source: string;
  command: string;
  created_at: string;
}

interface LabsViewProps {
  labs: Lab[];
  locations: Array<{ id: number; lab_id: string; aslung_id: string; active: number }>;
  search: string;
  setSearch: (s: string) => void;
  selectedLabs: Set<string>;
  setSelectedLabs: React.Dispatch<React.SetStateAction<Set<string>>>;
  setEditLab: (lab: Lab | null) => void;
  setModal: (m: string) => void;
  setConfirmation: (c: any) => void;
}

export default function LabsView({
  labs,
  locations,
  search,
  setSearch,
  selectedLabs,
  setSelectedLabs,
  setEditLab,
  setModal,
  setConfirmation,
}: LabsViewProps) {
  const filtered = labs.filter((l) =>
    (l.id + " " + l.city_name + " " + l.town_name + " " + l.location_name + " " + (l.description || "")).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="panel">
      <div className="list-heading">
        <div className="flex items-center gap-4">
          <h2>
            地點庫 (Lab ID) <span className="count">{labs.length}</span>
          </h2>
          <Input
            className="w-64 h-9 bg-white"
            placeholder="搜尋 ID、縣市或地點名稱..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {selectedLabs.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmation({
                  action: "labDeleteBulk",
                  ids: Array.from(selectedLabs),
                  title: `刪除所選 ${selectedLabs.size} 個地點？`,
                  description: `確認刪除所選的 ${selectedLabs.size} 筆地點資料？既有設備追蹤紀錄的地點名稱文字仍會保留。`,
                });
              }}
            >
              <Trash2 size={16} className="mr-1" />
              大量刪除 ({selectedLabs.size})
            </Button>
          )}
          <Button variant="secondary" onClick={() => setModal("labSync")}>
            <CloudDownload size={16} className="mr-1" />
            同步 Google 試算表
          </Button>
          <Button
            onClick={() => {
              setEditLab(null);
              setModal("lab");
            }}
          >
            <Plus size={16} />
            新增地點
          </Button>
        </div>
      </div>

      {!filtered.length ? (
        <Empty className="empty-area">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>{search ? "沒有符合的地點" : "尚無地點資料"}</EmptyTitle>
            <EmptyDescription className="text-sm">
              {search ? "請嘗試其他關鍵字。" : "點擊「同步 Google 試算表」匯入 300+ 筆地點，或點擊「新增地點」建立第一筆。"}
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
                    checked={selectedLabs.size === filtered.length && filtered.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedLabs(new Set(filtered.map((l) => l.id)));
                      else setSelectedLabs(new Set());
                    }}
                  />
                </TableHead>
                <TableHead>Lab ID</TableHead>
                <TableHead>縣市 / 鄉鎮</TableHead>
                <TableHead>地點名稱</TableHead>
                <TableHead>座標 (Lat, Lon)</TableHead>
                <TableHead>高度 / 站點類型</TableHead>
                <TableHead>詳細說明 / 備註</TableHead>
                <TableHead className="text-center">在線設備</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l, idx) => {
                const activeDeviceCount = locations.filter((loc) => loc.lab_id === l.id && loc.active).length;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-center font-mono text-xs text-slate-500">{idx + 1}</TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedLabs.has(l.id)}
                        onChange={(e) => {
                          const s = new Set(selectedLabs);
                          if (e.target.checked) s.add(l.id);
                          else s.delete(l.id);
                          setSelectedLabs(s);
                        }}
                      />
                    </TableCell>
                    <TableCell className="mono font-semibold text-slate-900">{l.id}</TableCell>
                    <TableCell>
                      {l.city_name || l.town_name ? (
                        <span className="font-medium text-slate-700">
                          {l.city_name} {l.town_name}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-slate-800">{l.location_name || <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {l.lat != null && l.lon != null ? `${Number(l.lat).toFixed(4)}, ${Number(l.lon).toFixed(4)}` : <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {l.height || l.source ? `${l.height || ''} ${l.source ? `(${l.source})` : ''}`.trim() : <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate" title={l.description || l.command || ''}>
                      {l.description || l.command || <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {activeDeviceCount > 0 ? (
                        <span className="status ok font-mono">{activeDeviceCount} 台</span>
                      ) : (
                        <span className="text-slate-400 text-xs">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditLab(l);
                            setModal("lab");
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
                              action: "labDelete",
                              id: l.id,
                              title: `刪除地點「${l.id}」？`,
                              description: "確認刪除此筆地點資料？",
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
