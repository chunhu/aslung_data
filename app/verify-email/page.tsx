import VerifyEmailForm from './form';
export const dynamic='force-dynamic';
export default async function VerifyEmail({searchParams}:{searchParams:Promise<{token?:string;lang?:string}>}) {
  const params=await searchParams;
  return <VerifyEmailForm token={params.token||''} isEnglish={params.lang==='en'}/>;
}
