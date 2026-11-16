import GuestFilesPublic from '@/components/GuestFilesPublic';
export const dynamic='force-dynamic';
export const metadata={title:'公開檔案清單 | File catalogue',referrer:'no-referrer' as const};
export default function FileCatalogue(){return <GuestFilesPublic/>;}
