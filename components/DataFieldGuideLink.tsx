import {FileText} from 'lucide-react';
import {Button} from '@/components/ui/button';

export default function DataFieldGuideLink({isEnglish=false}:{isEnglish?:boolean}){
  return <Button asChild variant="outline" size="sm" className="h-8 gap-1">
    <a href={'/docs/ASLUNG_Data_Fields_'+(isEnglish?'EN':'ZH')+'.html'} target="_blank" rel="noopener noreferrer" title={isEnglish?'Open documentation and download links in a new tab':'另開說明頁，內含文件下載連結'}>
      <FileText size={14}/>{isEnglish?'Field documentation':'欄位資料說明'}
    </a>
  </Button>;
}
