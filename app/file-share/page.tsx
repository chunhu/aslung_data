import GuestFilesPublic from '@/components/GuestFilesPublic';
export const dynamic='force-dynamic';
export const metadata={title:'訪客下載 | Guest download',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default function GuestDownload(){return <GuestFilesPublic share/>;}
