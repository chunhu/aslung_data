"use client";

type Issue={level:string;row:number;message:string};
export default function DeviceImportIssues({issues}:{issues:Issue[]}){
  if(!issues.length)return null;
  const errors=issues.filter(issue=>issue.level==='error').sort((a,b)=>a.row-b.row);
  const warnings=issues.filter(issue=>issue.level==='warning').sort((a,b)=>a.row-b.row);
  const rows=(items:Issue[])=>items.map((issue,index)=><li key={index} className="py-1 text-xs leading-5"><strong>第 {issue.row} 列</strong> · {issue.message}</li>);
  return <section aria-label="匯入資料檢查" className="space-y-3">
    <h3 className="text-sm font-semibold">資料檢查：{errors.length} 項錯誤、{warnings.length} 項提醒</h3>
    {errors.length>0&&<div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-rose-800">
      <h4 className="text-sm font-semibold">錯誤（{errors.length} 項，必須先修正才能匯入）</h4>
      <p className="mt-1 text-xs">請依來源表格列號修正後，按「返回修改」重新產生預覽。以下列出全部錯誤。</p>
      <ul className="mt-2 max-h-64 overflow-y-auto" aria-label="阻擋匯入的錯誤">{rows(errors)}</ul>
    </div>}
    {warnings.length>0&&<details open={!errors.length} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
      <summary className="cursor-pointer text-sm font-semibold">提醒（{warnings.length} 項，不阻擋匯入）</summary>
      <ul className="mt-2 max-h-44 overflow-y-auto" aria-label="匯入提醒">{rows(warnings)}</ul>
    </details>}
  </section>;
}
