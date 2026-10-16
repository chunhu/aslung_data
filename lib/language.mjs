export const LANGUAGE_COOKIE='aslung_language';
export function browserDisplayLanguage(locale){
  const tag=String(locale||'').trim().replaceAll('_','-').toLowerCase();
  if(!/^zh(?:-|$)/.test(tag)||tag.split('-').includes('hans'))return 'en';
  return tag.split('-').includes('hant')||/^zh-(tw|hk|mo)(?:-|$)/.test(tag)?'zh-TW':'en';
}
export function readLanguageCookie(cookies){
  const value=String(cookies||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(LANGUAGE_COOKIE+'='))?.slice(LANGUAGE_COOKIE.length+1);
  try{const decoded=decodeURIComponent(value||'');return ['en','zh-TW'].includes(decoded)?decoded:null;}catch{return null;}
}
export function resolveDisplayLanguage(cookies,browser,explicit){
  if(['en','zh-TW'].includes(explicit))return explicit;
  const saved=readLanguageCookie(cookies);if(saved)return saved;
  return browserDisplayLanguage(browser?.languages?.[0]||browser?.language);
}
export function applyDisplayLanguage(language,remember=false){
  if(!['en','zh-TW'].includes(language))return;
  if(remember)document.cookie=`${LANGUAGE_COOKIE}=${language}; path=/; max-age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
  // Replace the old translator cookie so browser defaults are not overridden by
  // a stale automatic translation choice from earlier versions.
  document.cookie='googtrans=; max-age=0; path=/; SameSite=Lax';
  document.cookie=`googtrans=; max-age=0; domain=${location.hostname}; path=/; SameSite=Lax`;
  document.cookie=`googtrans=/zh-TW/${language}; path=/; SameSite=Lax`;
  document.documentElement.lang=language==='en'?'en':'zh-Hant';
  window.dispatchEvent(new CustomEvent('aslung-language-change',{detail:language}));
}
