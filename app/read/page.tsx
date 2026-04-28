import Link from "next/link";

export default function ReadingView() {
  return (
    <div className="min-h-screen w-full bg-[#FDF9EF] font-noto">
      {/* MOBILE STICKY TOP BAR */}
      <div className="md:hidden sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-white/90 backdrop-blur-md shadow-sm border-b border-[#C4C6CD]/20">
        <Link href="/book" className="p-2 -ml-2 text-[#5F5E5E]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </Link>
        <span className="font-noto text-[14px] font-medium tracking-[0.1em] uppercase text-[#5F5E5E]">
          THE SHADOW OF THE WIND
        </span>
        <button className="p-2 -mr-2 text-[#5F5E5E]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>

      <div className="flex w-full max-w-[1400px] mx-auto relative pt-8 md:pt-24 pb-32 md:pb-48 px-6 md:px-12">
        
        {/* DESKTOP READING PROGRESS RAIL (LEFT) */}
        <div className="hidden md:flex flex-col items-center sticky top-32 w-24 h-[calc(100vh-200px)] shrink-0">
          <div className="w-[1px] h-32 bg-[#C4C6CD] opacity-50 mb-4"></div>
          <span className="text-[#5F5E5E] text-[12px] font-manrope font-bold tracking-[0.1em]">45%</span>
          <div className="w-[1px] flex-grow bg-[#C4C6CD] opacity-30 mt-4"></div>
        </div>

        {/* READING CANVAS (CENTER) */}
        <div className="flex-grow flex flex-col max-w-[760px] mx-auto w-full gap-12 md:gap-16">
          
          {/* Editorial Header */}
          <header className="flex flex-col gap-6 items-start md:items-center text-left md:text-center w-full">
            <div className="bg-[#ECE8DE] px-4 py-1.5 rounded-full inline-block">
              <span className="text-[#5F5E5E] font-manrope text-[11px] font-bold tracking-[0.08em] uppercase">
                VOL. I — THE CEMETERY OF FORGOTTEN BOOKS
              </span>
            </div>
            <h1 className="text-[#041729] font-noto text-[42px] md:text-[56px] font-bold leading-[1.1] tracking-[-0.025em]">
              The Cemetery of<br className="hidden md:block"/> Forgotten Books
            </h1>
            
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[#5F5E5E] font-manrope text-[13px] font-semibold tracking-[0.05em] uppercase">BY CARLOS RUIZ ZAFÓN</span>
              <div className="w-[30px] h-[1px] bg-[#C4C6CD]"></div>
              <span className="text-[#5F5E5E] font-manrope text-[13px] font-semibold tracking-[0.05em] uppercase">12 MIN READ</span>
            </div>
          </header>

          {/* Main Content */}
          <article className="flex flex-col gap-8 md:gap-10 text-[#221301] text-[18px] md:text-[20px] leading-[1.8] font-noto w-full">
            
            {/* Drop Cap Paragraph */}
            <p className="relative">
              <span className="float-left text-[64px] md:text-[80px] leading-[0.8] pr-3 pt-2 font-bold text-[#041729]">I</span>
              still remember the day my father took me to the Cemetery of Forgotten Books for the first time. It was the early summer of 1945, and we walked through the streets of a Barcelona trapped beneath ashen skies as a dawn of copper light poured over the Rambla of Santa Mónica in a garland of liquid copper.
            </p>

            <p>
              "Daniel, you mustn't tell anyone what you're about to see today," my father warned me. "Not even your friend Tomás. No one."
            </p>
            
            <p>
              "Not even Mama?" I asked in a whisper, aware that we were stepping into a world of secrets. My father sighed, hiding behind the sad smile that followed him like a shadow through life.
            </p>

            {/* Pull Quote */}
            <div className="my-8 md:my-12 px-6 md:px-10 py-8 border-l-2 border-[#041729] bg-[#F7F3E9]/50 rounded-r-lg relative">
              <p className="text-[22px] md:text-[26px] italic text-[#041729] font-medium leading-[1.6]">
                "Every book, every volume you see here, has a soul. The soul of the person who wrote it and of those who read it and lived and dreamed with it."
              </p>
            </div>

            <p>
              We walked through the silent corridors, surrounded by millions of volumes. The air tasted of old paper and dust, of magic and time. It was a sanctuary of memory, a place where books that had been lost in the world outside were kept safe, waiting for a new reader, a new life.
            </p>

            {/* Annotated Passage */}
            <div className="my-6 md:my-8 relative group">
              <div className="absolute -inset-4 bg-[#ECE8DE]/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 md:block hidden"></div>
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#221301] rounded-r-sm"></div>
              <div className="pl-6 relative">
                <p className="text-[#43474C]">
                  When a library disappears, or a bookshop closes down, when a book is consigned to oblivion, those of us who know this place, its guardians, make sure that it gets here. In this place, books no longer remembered by anyone, books that are lost in time, live forever, waiting for the day when they will reach a new reader's hands.
                </p>
                {/* Mobile Annotation Marker */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 md:hidden">
                  <div className="w-8 h-8 rounded-full bg-[#ECE8DE] flex items-center justify-center shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#221301" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </div>
                </div>
              </div>
            </div>

            <p>
              "This is a place of mystery, Daniel, a sanctuary," my father continued. "Every time someone enters this place for the first time, they must choose a book and adopt it, making sure that it will never disappear, that it will always stay alive. It's a very important promise."
            </p>

            <p>
              I looked up at the towering shelves, losing myself in the labyrinth of stories that surrounded me. I knew, with the certainty of childhood, that my life would be forever bound to this place.
            </p>

          </article>

          {/* Footer Section of Reader */}
          <footer className="mt-12 md:mt-20 pt-12 border-t border-[#C4C6CD]/30 flex flex-col md:flex-row items-center md:items-start justify-between gap-8 md:gap-0 w-full">
            <div className="flex flex-col items-center md:items-start text-center md:text-left gap-4 max-w-[400px]">
              <span className="text-[#5F5E5E] font-manrope text-[12px] font-bold tracking-[0.1em] uppercase">
                ABOUT THIS CHAPTER
              </span>
              <p className="text-[#43474C] font-manrope text-[14px] leading-relaxed">
                The opening sequence establishes the Cemetery of Forgotten Books, a central motif in Zafón's gothic Barcelona.
              </p>
            </div>
            <div className="flex gap-4 w-full md:w-auto">
              <button className="flex-1 md:flex-none border border-[#C4C6CD] text-[#5F5E5E] font-manrope text-[11px] font-bold tracking-[0.15em] uppercase px-6 py-4 rounded-md hover:bg-[#ECE8DE] transition-colors">
                ADD NOTE
              </button>
              <button className="flex-1 md:flex-none bg-[#041729] text-white font-manrope text-[11px] font-bold tracking-[0.15em] uppercase px-6 py-4 rounded-md shadow-md hover:bg-opacity-90 transition-colors">
                NEXT CHAPTER
              </button>
            </div>
          </footer>

        </div>
        
        {/* RIGHT MARGIN (FOR SYMMETRY ON DESKTOP) */}
        <div className="hidden md:block w-24 shrink-0"></div>

      </div>

      {/* MOBILE STICKY BOTTOM PROGRESS BAR */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#FDF9EF]/95 backdrop-blur-md border-t border-[#C4C6CD]/20 py-3 px-6 flex justify-between items-center shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <span className="text-[#5F5E5E] font-manrope text-[11px] font-bold tracking-[0.05em] uppercase">PAGE 3 OF 532</span>
        <span className="text-[#5F5E5E] font-manrope text-[11px] font-bold tracking-[0.05em] uppercase">12 MINS LEFT</span>
      </div>
      
      {/* MOBILE FLOATING ACTION BUTTON (ADD NOTE) */}
      <button className="md:hidden fixed bottom-20 right-6 w-14 h-14 bg-[#041729] text-white rounded-full flex items-center justify-center shadow-lg z-50">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/></svg>
      </button>

    </div>
  );
}
