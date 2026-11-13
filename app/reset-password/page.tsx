import PasswordRecoveryForm from '@/components/PasswordRecoveryForm';
export const dynamic='force-dynamic';
export const metadata={title:'設定新密碼 | Reset password',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function ResetPassword({searchParams}:{searchParams:Promise<{lang?:string}>}){
  const params=await searchParams;
  return <PasswordRecoveryForm mode="reset" isEnglish={params.lang==='en'?true:params.lang==='zh-TW'?false:undefined}/>;
}
