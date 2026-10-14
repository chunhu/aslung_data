import CountrySelect from '@/components/CountrySelect';
import {Label} from '@/components/ui/label';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
export type MemberProfile={country?:string;institution?:string;project_name?:string;project_summary?:string;requested_access?:string;
  registration_status?:string;registered_at?:string;email_verified_at?:string;reviewed_at?:string;reviewed_by?:string;review_note?:string};

export default function MemberProfileFields({profile={},required=false,isEnglish=false}:{profile?:MemberProfile;required?:boolean;isEnglish?:boolean}) {
  const mark=required?' *':'';
  return <div className="space-y-4 min-w-0">
    <div className="space-y-2"><Label>{(isEnglish?'Country / region':'國家／地區')+mark}</Label><CountrySelect defaultValue={profile.country||''} required={required} isEnglish={isEnglish}/></div>
    <div className="space-y-2"><Label htmlFor="profile-institution">{(isEnglish?'Institution / team':'所屬機構／團隊')+mark}</Label><Input id="profile-institution" name="institution" required={required} maxLength={200} defaultValue={profile.institution||''}/></div>
    <div className="space-y-2"><Label htmlFor="profile-project">{(isEnglish?'Collaboration project name':'合作計畫名稱')+mark}</Label><Input id="profile-project" name="project_name" required={required} maxLength={200} defaultValue={profile.project_name||''}/></div>
    <div className="space-y-2"><Label htmlFor="profile-summary">{(isEnglish?'Project summary and intended data use':'合作計畫簡述及資料用途')+mark}</Label><Textarea id="profile-summary" name="project_summary" required={required} maxLength={1000} rows={4} defaultValue={profile.project_summary||''}/><p className="text-xs text-slate-500">{isEnglish?'Describe the purpose, research and intended use (up to 1,000 characters).':'請簡述合作目的、研究內容及資料用途，上限 1,000 字。'}</p></div>
    <div className="space-y-2"><Label htmlFor="profile-access">{isEnglish?'Requested data scope (optional)':'申請資料範圍（選填）'}</Label><Textarea id="profile-access" name="requested_access" rows={2} maxLength={1000} defaultValue={profile.requested_access||''} placeholder={isEnglish?'lab_id, device IDs and date range':'需要的 lab_id、設備編號與資料期間'}/></div>
  </div>;
}
