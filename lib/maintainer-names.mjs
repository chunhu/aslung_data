export function maintainerDisplayName(name,maintainers=[],isEnglish=false){
  const record=maintainers.find(m=>m.name===name);
  return isEnglish&&record?.english_name?.trim()?record.english_name.trim():(name||'');
}
