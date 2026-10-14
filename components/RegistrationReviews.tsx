"use client";
import {useState} from 'react';
import {countryOptions} from '@/lib/countries.mjs';
import {MemberProfile} from '@/components/MemberProfileFields';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';

type Applicant=MemberProfile&{email:string;name:string;nickname?:string|null;active:number};
export default function RegistrationReviews({members,busy,isEnglish:en,onReview,onGrant,mailConfigured,onMailSettings}:{members:Applicant[];busy:boolean;isEnglish:boolean;
  mailConfigured:boolean;onMailSettings:()=>void;onReview:(email:string,decision:string,note:string)=>Promise<boolean>;onGrant:(email:string)=>void}) {
  const [filter,setFilter]=useState('pending_review'),[search,setSearch]=useState(''),[notes,setNotes]=useState<Record<string,string>>({});
  const applications=members.filter(m=>m.registered_at);
  const names=countryOptions(en?'en':'zh-Hant');
  const labels:Record<string,string>=en?{pending_email:'Awaiting email verification',pending_review:'Awaiting review',approved:'Approved',rejected:'Rejected'}:
    {pending_email:'待驗證 Email',pending_review:'待審核',approved:'審核通過',rejected:'未通過'};
  const filtered=applications.filter(m=>(filter==='all'||m.registration_status===filter)&&
    `${m.name} ${m.email} ${m.country} ${names.find(c=>c.code===m.country)?.name||''} ${m.institution} ${m.project_name} ${m.project_summary}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="panel p-5 mb-5 space-y-4">
    <div><h2 className="text-lg font-semibold">{en?'Registration applications':'會員註冊申請'} <span className="text-teal-700">{applications.filter(m=>m.registration_status==='pending_review').length}</span></h2>
      <p className="text-sm text-slate-500 mt-1">{en?'Email verification is required before approval. Assign data permissions separately after approval.':'完成 Email 驗證後才能核准帳號；核准後請另外設定設備、地點與資料期間授權。'}</p></div>
    {!mailConfigured&&<div role="status" className="bg-amber-50 border border-amber-200 rounded p-3 text-sm space-y-2"><p>{en?'Registration email is not configured. Set the SMTP host and sender before accepting new applications.':'註冊郵件尚未設定。請先填寫 SMTP 主機與寄件者地址，才能接受新註冊申請及寄送驗證信。'}</p><Button type="button" variant="outline" onClick={onMailSettings}>{en?'Configure email':'設定郵件'}</Button></div>}
    <div className="flex flex-wrap gap-3"><select aria-label={en?'Application status':'申請狀態'} className="border rounded px-3 py-2 text-sm" value={filter} onChange={e=>setFilter(e.target.value)}>
      <option value="all">{en?'All applications':'所有申請'}</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <Input className="min-w-0 flex-1 basis-60" aria-label={en?'Search applications':'搜尋註冊申請'} placeholder={en?'Name, country, institution or project':'姓名、國家、機構或計畫'} value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {!filtered.length&&<p className="text-sm text-slate-500 py-4">{en?'No matching applications.':'目前沒有符合條件的申請。'}</p>}
    {filtered.map(m=><article key={m.email} className="border rounded-lg p-4 space-y-3 min-w-0">
      <div className="flex justify-between flex-wrap gap-2"><strong className="break-all">{m.name} · {m.nickname} · {m.email}</strong><span className="status pending">{labels[m.registration_status||'approved']}</span></div>
      <dl className="grid sm:grid-cols-2 gap-3 text-sm [overflow-wrap:anywhere]">
        <div><dt className="text-slate-500">{en?'Country / region':'國家／地區'}</dt><dd>{names.find(c=>c.code===m.country)?.name||m.country||'—'}</dd></div>
        <div><dt className="text-slate-500">{en?'Institution / team':'所屬機構／團隊'}</dt><dd>{m.institution||'—'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-slate-500">{en?'Collaboration project':'合作計畫'}</dt><dd className="font-medium">{m.project_name||'—'}</dd><dd className="whitespace-pre-wrap mt-1">{m.project_summary||'—'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-slate-500">{en?'Requested data scope':'申請資料範圍'}</dt><dd className="whitespace-pre-wrap">{m.requested_access||'—'}</dd></div>
        <div><dt className="text-slate-500">{en?'Submitted':'申請時間'}</dt><dd>{m.registered_at}</dd></div>
        <div><dt className="text-slate-500">{en?'Email verified':'Email 驗證時間'}</dt><dd>{m.email_verified_at||labels.pending_email}</dd></div>
      </dl>
      {m.review_note&&<p className="text-sm whitespace-pre-wrap break-words">{en?'Review note: ':'審核備註：'}{m.review_note}</p>}
      {['pending_review','rejected'].includes(m.registration_status||'')&&<div className="space-y-2">
        <Textarea aria-label={(en?'Review note: ':'審核備註：')+m.email} maxLength={1000} rows={2} placeholder={en?'Review note (optional, up to 1,000 characters)':'審核備註（選填，上限 1,000 字）'} value={notes[m.email]||''} onChange={e=>setNotes({...notes,[m.email]:e.target.value})}/>
        <div className="flex gap-2"><Button type="button" disabled={busy||!m.email_verified_at} onClick={()=>void onReview(m.email,'approve',notes[m.email]||'')}>{en?'Approve account':'核准帳號'}</Button>
          {m.registration_status==='pending_review'&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void onReview(m.email,'reject',notes[m.email]||'')}>{en?'Reject application':'不予核准'}</Button>}</div>
      </div>}
      {m.registration_status==='approved'&&m.active===1&&<Button type="button" variant="outline" disabled={busy} onClick={()=>onGrant(m.email)}>{en?'Assign data permissions':'設定資料授權'}</Button>}
    </article>)}
  </section>;
}
