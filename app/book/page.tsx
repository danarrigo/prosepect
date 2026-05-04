import Image from "next/image"

export default function BookDetail() {
  return (
    <div className="min-h-screen w-full bg-[#FDF9EF]">
      <div className="flex w-full flex-col items-center">
        {/* Main Container */}
        <div className="flex w-full max-w-[1400px] flex-col gap-16 md:gap-32 px-6 md:px-12 py-12 md:py-24">

          {/* Top Section */}
          <div className="flex flex-col md:flex-row gap-8 md:gap-24 items-center md:items-start w-full">
            {/* Left Col - Image & Mobile Metadata */}
            <div className="w-full md:w-[450px] shrink-0 flex flex-col gap-6 md:gap-8 relative items-center md:items-start">
              {/* The book image container */}
              <div className="w-full flex justify-center items-center py-6 md:aspect-[2/3] md:bg-[#ECE8DE] md:rounded-lg md:p-6 md:relative md:shadow-none">
                <div className="relative w-[180px] h-[270px] md:w-full md:h-full shrink-0 bg-[#E6E2D8] rounded-sm shadow-[0_24px_48px_0_rgba(28,28,22,0.12),0_0_0_1px_rgba(196,198,205,0.15)]">
                  <img src="/melancholy_cover.png" className="w-full h-full object-cover rounded-sm" alt="The Melancholy of Anatomy" />
                  <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-black/20 to-transparent"></div>
                  <div className="absolute inset-0 bg-[linear-gradient(66deg,transparent_0%,rgba(255,255,255,0.05)_50%,transparent_100%)] pointer-events-none rounded-sm"></div>
                </div>
              </div>

              {/* Mobile Metadata (Hidden on Desktop) */}
              <div className="flex md:hidden flex-col items-center gap-6 w-full">
                <div className="flex flex-col items-center gap-2 text-center mt-2">
                  <h1 className="text-[#041729] font-noto text-[32px] font-medium leading-[1.1] tracking-[-0.025em]">The Melancholy of<br />Anatomy</h1>
                  <p className="text-[#5F5E5E] text-[11px] font-medium tracking-[0.08em] uppercase mt-2">BY ARTHUR PENDELTON</p>
                </div>

                <div className="flex items-center gap-3 bg-[#F7F3E9] px-4 py-1.5 rounded-[12px]">
                  <span className="text-[#43474C] text-[13px]">342 Pages</span>
                  <div className="w-1 h-1 rounded-full bg-[#C4C6CD]"></div>
                  <span className="text-[#43474C] text-[13px]">1st Ed. 1928</span>
                </div>

                <a href="./read" className="w-full max-w-[342px] bg-gradient-to-b from-[#041729] to-[#1A2C3E] text-[#FFFFFF] py-4 rounded-[2px] text-[15px] font-medium tracking-[0.025em] shadow-[0_12px_32px_0_rgba(4,23,41,0.15)] mt-4 flex justify-center items-center">
                  Begin Reading
                </a>
              </div>
              {/* Badges (Desktop only or hidden on small mobile) */}
              <div className="hidden md:flex gap-4 justify-center w-full">
                <span className="bg-[#F7F3E9] px-4 py-2 text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase rounded-sm hover:font-extrabold transition-all">FIRST EDITION</span>
                <span className="bg-[#F7F3E9] px-4 py-2 text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase rounded-sm hover:font-extrabold transition-all">HARDCOVER</span>
              </div>
            </div>

            {/* Right Col - Info */}
            <div className="flex flex-col gap-8 md:gap-12 w-full">
              {/* Desktop Metadata */}
              <div className="hidden md:flex flex-col gap-4">
                <div className="flex items-center gap-2 text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">
                  <span>FICTION</span>
                  <span className="text-[#C4C6CD]">/</span>
                  <span>HISTORICAL MYSTERY</span>
                </div>
                <h1 className="text-[#041729] font-noto text-[72px] font-bold leading-none tracking-[-0.025em]">The Melancholy of<br />Anatomy</h1>
                <p className="text-[#221301] font-noto text-[24px]">by Arthur Pendelton</p>
              </div>

              <div className="hidden md:flex items-center gap-8">
                <a href="./read" className="bg-[#041729] text-[#FDF9EF] px-12 py-5 rounded-md text-[14px] font-bold tracking-[1.4px] uppercase shadow-lg hover:bg-opacity-90 transition-all hover:scale-110 duration-300">
                  BEGIN READING
                </a>
                <div className="flex items-center gap-2 text-[#5F5E5E] text-[12px] font-bold tracking-[1.2px] uppercase">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                  <span>4.8 / 12K REVIEWS</span>
                </div>
              </div>

              <div className="flex flex-col gap-8 md:gap-12 pt-0 md:pt-4">
                {/* Synopsis */}
                <div className="flex flex-col gap-4 md:gap-6 relative">
                  {/* Decorative line for mobile */}
                  <div className="absolute left-[-24px] top-2 bottom-0 w-[2px] bg-[#B6C8E0] opacity-30 md:hidden"></div>

                  <div className="flex items-center gap-4">
                    <h3 className="text-[#041729] md:text-[#5F5E5E] text-[22px] md:text-[10px] font-noto md:font-manrope font-medium md:font-extrabold tracking-[-0.025em] md:tracking-[3.2px] md:uppercase hover:text-[#000000] transition-colors duration-300">
                      {/* Using conditional rendering or just CSS classes for text style differences */}
                      <span className="md:hidden">Synopsis</span>
                      <span className="hidden md:inline">SYNOPSIS</span>
                    </h3>
                    <div className="hidden md:block h-[1px] w-12 bg-[#C4C6CD] opacity-30"></div>
                  </div>
                  <div className="flex flex-col gap-4 md:gap-6 text-[#43474C] text-[16px] md:text-[18px] leading-[1.6] md:leading-[1.8] max-w-3xl">
                    <p>In the waning days of the Victorian era, amidst the fog-choked streets of London, an obscure anatomist discovers a peculiar anomaly within the city's newest cadaver. It is not a disease of the flesh, but a crystallization of memories—a tangible sorrow lodged near the heart.</p>
                    <p>Arthur Pendelton's masterwork is a gothic exploration of grief, science, and the indelible marks we leave upon the physical world long after our breath has ceased. It is a treatise disguised as a thriller, demanding the reader's full intellectual surrender.</p>
                  </div>
                </div>

                {/* Author Info */}
                <div className="bg-[#F7F3E9] p-6 md:p-12 rounded-lg flex flex-col md:flex-row gap-6 md:gap-8 items-start relative overflow-hidden hover:scale-110 transition-all duration-500">
                  <div className="absolute top-[-40px] right-[-40px] w-40 h-40 bg-[#E6E2D8] opacity-40 rounded-[20px] rotate-12"></div>

                  <img src="/pendelton.png" className="w-16 h-16 md:w-24 md:h-24 rounded-xl border-4 md:border-2 border-[#FDF9EF] object-cover relative z-10 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]" alt="Arthur Pendelton" />
                  <div className="flex flex-col gap-1 md:gap-3 relative z-10 ">
                    <h3 className="text-[#5F5E5E] text-[10px] md:text-[10px] font-medium md:font-extrabold tracking-[0.1em] md:tracking-[3.2px] uppercase">ABOUT THE AUTHOR</h3>
                    <h4 className="text-[#041729] font-noto font-medium md:font-bold text-[18px] md:text-[24px]">Arthur Pendelton</h4>
                    <p className="text-[#43474C] text-[14px] leading-[22.75px] max-w-xl mt-1 md:mt-0">
                      A former surgeon turned novelist, Pendelton spent his final years in recluse on the Scottish coast, producing only three known manuscripts before his mysterious disappearance in 1932.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Reader Reflections Section */}
          <div className="flex flex-col w-full gap-8 md:gap-12 mt-2 md:mt-0">
            <div className="flex justify-between items-center w-full">
              <h3 className="text-[#041729] md:text-[#5F5E5E] text-[22px] md:text-[10px] font-noto md:font-manrope font-medium md:font-extrabold tracking-[-0.025em] md:tracking-[3.2px] uppercase text-left md:text-center md:w-full hover:text-[#000000] transition-colors duration-300">
                <span className="md:hidden">Reader Reflections</span>
                <span className="hidden md:inline">READER REFLECTIONS</span>
              </h3>
              <button className="md:hidden text-[#5F5E5E] text-[11px] font-medium tracking-[0.08em]">SEE ALL</button>
            </div>

            {/* Vertical stack on mobile, grid on desktop */}
            <div className="flex flex-col md:grid md:grid-cols-3 gap-4 md:gap-8 w-full pb-8 md:pb-0">

              <div className="bg-[#F1EEE4] rounded-[4px] pt-7 px-6 pb-6 md:p-10 flex flex-col justify-between gap-6 md:gap-8 w-full h-full">
                <p className="text-[#041729] font-noto text-[15px] leading-[24.38px]">"A hauntingly beautiful descent into the macabre. Pendelton's prose reads like poetry etched in bone."</p>
                <div className="flex flex-col md:flex-row md:items-center gap-4 pt-4 border-t border-[#C4C6CD] border-opacity-50">
                  <div className="hidden md:flex w-8 h-8 rounded-full bg-[#1A2C3E] items-center justify-center text-[#FDF9EF] text-[10px] font-bold">LR</div>
                  <span className="text-[#5F5E5E] text-[11px] tracking-[0.1em] uppercase">THE LITERARY REVIEW</span>
                </div>
              </div>

              <div className="bg-[#F1EEE4] rounded-[4px] pt-7 px-6 pb-6 md:p-10 flex flex-col justify-between gap-6 md:gap-8 w-full h-full">
                <p className="text-[#041729] font-noto text-[15px] leading-[24.38px]">"Unsettling, profound, and thoroughly intoxicating. I found myself reading the final chapters by candlelight."</p>
                <div className="flex flex-col md:flex-row md:items-center gap-4 pt-4 border-t border-[#C4C6CD] border-opacity-50">
                  <div className="hidden md:flex w-8 h-8 rounded-full bg-[#39270F] items-center justify-center text-[#FDF9EF] text-[10px] font-bold">EB</div>
                  <span className="text-[#5F5E5E] text-[11px] tracking-[0.1em] uppercase">E. BLACKWOOD, CURATED READER</span>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </div >
  )
}
