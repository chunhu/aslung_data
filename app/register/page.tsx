import RegistrationForm from './form';
export default async function Register({searchParams}:{searchParams:Promise<{lang?:string}>}) {
  const params=await searchParams;
  return <RegistrationForm initialLanguage={['en','zh-TW'].includes(params.lang||'')?params.lang:undefined}/>;
}
