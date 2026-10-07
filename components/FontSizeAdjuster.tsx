"use client";
import { useEffect, useState } from "react";
import { Type, Minus, Plus } from "lucide-react";

export default function FontSizeAdjuster() {
  const [fontSize, setFontSize] = useState<number>(17); // Default to slightly larger (17px) based on user feedback
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("aslung_fontsize");
    if (saved && !isNaN(Number(saved))) {
      setFontSize(Number(saved));
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.style.fontSize = `${fontSize}px`;
      localStorage.setItem("aslung_fontsize", fontSize.toString());
    }
  }, [fontSize, mounted]);

  if (!mounted) return <div className="w-[84px] h-8" />; // Placeholder to prevent layout shift

  return (
    <div className="flex items-center gap-0.5 bg-white/50 border border-slate-200 rounded-md px-1.5 h-8">
      <Type size={14} className="text-muted-foreground mr-1" />
      <button 
        className="p-1 hover:text-blue-600 hover:bg-slate-100 rounded disabled:opacity-50 transition-colors"
        onClick={() => setFontSize(f => Math.max(12, f - 1))}
        disabled={fontSize <= 12}
        title="縮小字體"
        aria-label="Decrease Font Size"
      >
        <Minus size={14} />
      </button>
      <span className="text-xs font-mono w-6 text-center select-none" title="目前的字體大小">{fontSize}</span>
      <button 
        className="p-1 hover:text-blue-600 hover:bg-slate-100 rounded disabled:opacity-50 transition-colors"
        onClick={() => setFontSize(f => Math.min(28, f + 1))}
        disabled={fontSize >= 28}
        title="放大字體"
        aria-label="Increase Font Size"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
