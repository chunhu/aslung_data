import PasswordRecoveryForm from '@/components/PasswordRecoveryForm';
export const dynamic='force-dynamic';
export const metadata={title:'忘記密碼 | Forgot password',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function ForgotPassword({searchParams}:{searchParams:Promise<{lang?:string}>}){
  const params=await searchParams;
  return <PasswordRecoveryForm mode="request" isEnglish={params.lang==='en'?true:params.lang==='zh-TW'?false:undefined}/>;
}
