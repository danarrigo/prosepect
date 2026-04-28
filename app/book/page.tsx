import Image from "next/image"

export default function BookDetail() {
  return (
    <div className="min-h-screen w-full bg-[#FDF9EF]">
      <div className="flex w-full flex-col items-center">
        {/* Main Container */}
        <div className="flex w-full max-w-[1400px] flex-col gap-16 md:gap-32 px-6 md:px-12 py-12 md:py-24">
          
          {/* Mobile Metadata (Hidden on Desktop) */}
          <div className="flex md:hidden flex-col items-center gap-6 mt-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="text-[#041729] font-noto text-[32px] font-medium leading-[1.1] tracking-[-0.025em]">The Shadow of<br/>the Wind</h1>
              <p className="text-[#5F5E5E] text-[11px] font-medium tracking-[0.08em] uppercase mt-2">BY CARLOS RUIZ ZAFÓN</p>
            </div>
            
            <div className="flex items-center gap-3 bg-[#F7F3E9] px-4 py-1.5 rounded-full">
              <span className="text-[#43474C] text-[13px]">532 Pages</span>
              <div className="w-1 h-1 rounded-full bg-[#C4C6CD]"></div>
              <span className="text-[#43474C] text-[13px]">1st Ed. 2001</span>
            </div>

            <button className="w-full max-w-[342px] bg-[#041729] text-[#FFFFFF] py-4 rounded-sm text-[15px] font-medium tracking-[0.025em] shadow-lg mt-2">
              Begin Reading
            </button>
          </div>

          {/* Top Section */}
          <div className="flex flex-col md:flex-row gap-12 md:gap-24 items-center md:items-start w-full">
            {/* Left Col - Image */}
            <div className="w-[240px] sm:w-[320px] md:w-[450px] shrink-0 flex flex-col gap-6 md:gap-8 relative">
              {/* The book image container */}
              <div className="w-full aspect-[2/3] bg-[#ECE8DE] rounded-lg p-4 md:p-6 relative">
                 <img src="/mainbook.png" className="w-full h-full object-cover shadow-2xl rounded-sm" alt="The Shadow of the Wind" />
              </div>
              {/* Badges (Desktop only or hidden on small mobile) */}
              <div className="hidden md:flex gap-4 justify-center w-full">
                 <span className="bg-[#F7F3E9] px-4 py-2 text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase rounded-sm">FIRST EDITION</span>
                 <span className="bg-[#F7F3E9] px-4 py-2 text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase rounded-sm">HARDCOVER</span>
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
                <h1 className="text-[#041729] font-noto text-[72px] font-bold leading-none tracking-[-0.025em]">The Shadow of<br/>the Wind</h1>
                <p className="text-[#221301] font-noto text-[24px]">by Carlos Ruiz Zafón</p>
              </div>
              
              <div className="hidden md:flex items-center gap-8">
                <button className="bg-[#041729] text-[#FDF9EF] px-12 py-5 rounded-md text-[14px] font-bold tracking-[1.4px] uppercase shadow-lg hover:bg-opacity-90 transition-all">
                  BEGIN READING
                </button>
                <div className="flex items-center gap-2 text-[#5F5E5E] text-[12px] font-bold tracking-[1.2px] uppercase">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  <span>4.8 / 12K REVIEWS</span>
                </div>
              </div>

              <div className="flex flex-col gap-8 md:gap-12 pt-0 md:pt-4">
                {/* Synopsis */}
                <div className="flex flex-col gap-4 md:gap-6 relative">
                  {/* Decorative line for mobile */}
                  <div className="absolute left-[-24px] top-2 bottom-0 w-[2px] bg-[#B6C8E0] opacity-30 md:hidden"></div>
                  
                  <div className="flex items-center gap-4">
                    <h3 className="text-[#041729] md:text-[#5F5E5E] text-[22px] md:text-[10px] font-noto md:font-manrope font-medium md:font-extrabold tracking-[-0.025em] md:tracking-[3.2px] md:uppercase">
                      {/* Using conditional rendering or just CSS classes for text style differences */}
                      <span className="md:hidden">Synopsis</span>
                      <span className="hidden md:inline">SYNOPSIS</span>
                    </h3>
                    <div className="hidden md:block h-[1px] w-12 bg-[#C4C6CD] opacity-30"></div>
                  </div>
                  <div className="flex flex-col gap-4 md:gap-6 text-[#43474C] text-[16px] md:text-[18px] leading-[1.6] md:leading-[1.8] max-w-3xl">
                    <p>Barcelona, 1945: A city slowly heals in the aftermath of the Spanish Civil War. Daniel Sempere, an antiquarian book dealer's son who mourns the loss of his mother, is confronted by a mysterious secret society known as the Cemetery of Forgotten Books.</p>
                    <p>There, he is tasked with protecting a single volume: <span className="text-[#041729] font-semibold">The Shadow of the Wind</span> by Julián Carax. But as Daniel begins to unravel the story of the author, he discovers that someone is systematically burning every copy of every book Carax has ever written. What began as a literary curiosity soon becomes a race through the dark streets of Barcelona to uncover a truth buried by obsession and tragedy.</p>
                  </div>
                </div>

                {/* Author Info */}
                <div className="bg-[#F7F3E9] p-6 md:p-12 rounded-lg flex flex-col md:flex-row gap-6 md:gap-8 items-start relative overflow-hidden">
                  <div className="absolute top-[-40px] right-[-40px] w-40 h-40 bg-[#E6E2D8] opacity-40 rounded-[20px] rotate-12"></div>
                  
                  <img src="/profilepic.jpg" className="w-20 h-20 md:w-24 md:h-24 rounded-xl border-2 border-[#FDF9EF] object-cover relative z-10" alt="Carlos Ruiz Zafón" />
                  <div className="flex flex-col gap-2 md:gap-3 relative z-10">
                    <h3 className="text-[#5F5E5E] text-[11px] md:text-[10px] font-medium md:font-extrabold tracking-[0.08em] md:tracking-[3.2px] uppercase">ABOUT THE AUTHOR</h3>
                    <h4 className="text-[#041729] font-noto font-medium md:font-bold text-[24px]">Carlos Ruiz Zafón</h4>
                    <p className="text-[#43474C] text-[14px] leading-relaxed max-w-xl mt-2 md:mt-0">
                      One of the world's most read and best-loved authors, Zafón's work has been published in forty-five countries and translated into more than forty languages. His "Cemetery of Forgotten Books" series is a landmark of modern gothic literature.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Reader Reflections Section */}
          <div className="flex flex-col w-full gap-8 md:gap-12 mt-8 md:mt-0">
            <div className="flex justify-between items-center w-full">
              <h3 className="text-[#041729] md:text-[#5F5E5E] text-[22px] md:text-[10px] font-noto md:font-manrope font-medium md:font-extrabold tracking-[-0.025em] md:tracking-[3.2px] uppercase text-left md:text-center md:w-full">
                <span className="md:hidden">Reader Reflections</span>
                <span className="hidden md:inline">READER REFLECTIONS</span>
              </h3>
              <button className="md:hidden text-[#5F5E5E] text-[11px] font-medium tracking-[0.08em]">SEE ALL</button>
            </div>
            
            {/* Horizontal scroll on mobile, grid on desktop */}
            <div className="flex md:grid md:grid-cols-3 gap-4 md:gap-8 w-full overflow-x-auto pb-8 md:pb-0 scrollbar-none -mx-6 md:mx-0 px-6 md:px-0">
              
              <div className="bg-white md:bg-white border border-gray-100 shadow-sm rounded-md p-6 md:p-10 flex flex-col justify-between gap-6 md:gap-8 min-w-[280px] md:min-w-0 h-full shrink-0">
                <p className="text-[#041729] md:text-[#43474C] font-noto text-[16px] leading-relaxed">"A love letter to the power of the written word. Every sentence feels hand-crafted and weighed with history."</p>
                <div className="flex flex-col md:flex-row md:items-center gap-4 pt-4 border-t border-[#C4C6CD] md:border-t-0 md:pt-0 border-opacity-30">
                  <div className="hidden md:flex w-8 h-8 rounded-full bg-[#1A2C3E] items-center justify-center text-[#FDF9EF] text-[10px] font-bold">EM</div>
                  <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1px] uppercase">ELEANOR M.</span>
                </div>
              </div>

              <div className="bg-white md:bg-[#F1EEE4] border border-gray-100 md:border-none shadow-sm md:shadow-none rounded-md p-6 md:p-10 flex flex-col justify-between gap-6 md:gap-8 min-w-[280px] md:min-w-0 h-full shrink-0">
                <p className="text-[#041729] md:text-[#43474C] font-noto text-[16px] leading-relaxed">"Atmospheric, haunting, and utterly immersive. Barcelona has never felt so alive and so dangerous."</p>
                <div className="flex flex-col md:flex-row md:items-center gap-4 pt-4 border-t border-[#C4C6CD] md:border-t-0 md:pt-0 border-opacity-30">
                  <div className="hidden md:flex w-8 h-8 rounded-full bg-[#39270F] items-center justify-center text-[#FDF9EF] text-[10px] font-bold">JH</div>
                  <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1px] uppercase">JULIAN H.</span>
                </div>
              </div>

              <div className="bg-white border border-gray-100 shadow-sm rounded-md p-6 md:p-10 flex flex-col justify-between gap-6 md:gap-8 min-w-[280px] md:min-w-0 h-full shrink-0">
                <p className="text-[#041729] md:text-[#43474C] font-noto text-[16px] leading-relaxed">"One of those rare books that makes you want to visit every bookstore you pass. Truly magical."</p>
                <div className="flex flex-col md:flex-row md:items-center gap-4 pt-4 border-t border-[#C4C6CD] md:border-t-0 md:pt-0 border-opacity-30">
                  <div className="hidden md:flex w-8 h-8 rounded-full bg-[#E4E2E1] items-center justify-center text-[#041729] text-[10px] font-bold">SC</div>
                  <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1px] uppercase">SARAH C.</span>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
