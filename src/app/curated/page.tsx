import { auth } from "../../auth";
import { redirect } from "next/navigation";

export default async function CuratedPage() {
  const session = await auth();
  if (!session) {
    redirect("/signup");
  }

  return (
    <>
      <div className="hidden md:block min-h-screen w-full bg-[#FDF9EF]">
        <div className="flex w-full flex-col items-start">{/*Main*/}
          <div className="flex px-12 pt-12 pb-24 flex-col justify-center items-center self-stretch"> {/*Hero Section */}
            <div className="grid w-full max-w-[1400px] mx-auto gap-16 grid-rows-[600px] grid-cols-12">
              <div className="flex flex-col items-start gap-6 row-start-1 row-span-1 col-start-1 col-span-5 justify-self-stretch self-center">{/*Text Content*/}
                <div className="flex flex-col items-start self-stretch">
                  <p className="self-stretch text-[#5F5E5E] text-[12px]/[16px] not-italic font-normal tracking-[2.4px] uppercase">VOLUME IV • WINTER EDITION</p>
                </div>
                <div className="flex flex-col items-start self-stretch">
                  <h1 className="self-stretch text-[#041729] font-noto text-[96px]/[96px] not-italic font-normal tracking-[-9.6px] mb-[20px]">The Art Of</h1>
                  <h1 className="self-stretch text-[#041729] font-noto text-[96px]/[normal] not-italic font-normal">Quiet</h1>
                  <h1 className="self-stretch text-[#041729] font-noto text-[96px]/[96px] not-italic font-normal tracking-[-9.6px] mt-[-20px]">Reading</h1>
                </div>
                <div className="flex w-[448px] max-w-[448px] pt-[7.25px] flex-col items-start">
                  <p className="text-[#5F5E5E] text-[18px]/[29.25px] not-italic font-normal">A selection of hand-picked titles exploring the
                    intersection of philosophy, solitude, and the modern
                    world.</p>
                </div>
                <div className="flex pt-4 items-center gap-8 self-stretch">
                  <a href="../library" className="flex py-5 px-10 flex-col justify-center items-center rounded-md bg-[#041729] text-[#FDF9EF] align-center text-sm not-italic font-semibold tracking-[1.4px] uppercase hover:bg-[#042904] hover:scale-110 transition-all cursor-pointer duration-300">EXPLORE COLLECTION</a>
                  <a href="../journals" className="relative flex pb-1 flex-col justify-center items-center border-b border-solid border-b-[#C4C6CD] text-[#041729] align-center text-sm not-italic font-semibold tracking-[1.4px] uppercase hover:text-[#042904] hover:scale-110 transition-all duration-300 cursor-pointer after:content-[''] after:absolute after:bottom-[-1px] after:left-1/2 after:h-[2px] after:w-0 after:-translate-x-1/2 after:bg-[#000000] after:transition-all after:duration-300 hover:after:w-full">
                    VIEW JOURNALS
                  </a>
                </div>
              </div>
              <div className="flex h-[600px] justify-center items-center row-span-1 row-start-1 col-span-7 col-start-6 self-stretch -space-x-16">{/*Book Display*/}
                <div className="relative flex w-[240px] rotate-[-6deg] flex-col justify-center items-start aspect-[2/3] mt-[10%] opacity-80 z-0">
                  <div className="absolute inset-0 w-full h-full shadow-xl bg-transparent rounded-sm"></div>
                  <img src="/leftbook.png" className="w-full h-full rounded-sm object-cover" alt="Left book" />
                  <div className="absolute inset-0 w-full h-full bg-black/5 rounded-sm"></div>
                </div>
                <div className="relative flex w-[320px] h-[480px] flex-col justify-center items-start aspect-[2/3] z-10 shadow-2xl rounded-sm">
                  <img src="/mainbook.png" className="w-full h-full rounded-sm object-cover border-l border-4 border-[#041729]/20" alt="Main book" />
                  <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-black/20 via-transparent to-transparent rounded-sm"></div>
                </div>
                <div className="relative flex w-[240px] rotate-6 flex-col justify-center items-start aspect-[2/3] mb-[10%] opacity-80 z-0">
                  <div className="absolute inset-0 w-full h-full shadow-xl bg-transparent rounded-sm"></div>
                  <img src="/rightbook.png" className="w-full h-full rounded-sm object-cover" alt="Right book" />
                  <div className="absolute inset-0 w-full h-full bg-black/5 rounded-sm"></div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex py-32 px-12 flex-col items-start self-stretch bg-[#F7F3E9]">{/*Curated Collection Section*/}
            <div className="flex max-w-[1400px] w-full mx-auto flex-col items-start gap-20 self-stretch">{/*Container 1  */}
              <div className="flex justify-between items-end self-stretch">{/*Container 2 */}
                <div className="flex flex-col gap-6 max-w-2xl">
                  <h2 className="text-[#041729] font-noto text-[48px] font-normal leading-tight">The Curator's Choice</h2>
                  <p className="text-[#5F5E5E] text-[16px] font-normal leading-relaxed">A refined selection of this month's most profound narratives, curated by our resident bibliophiles and literary critics.</p>
                </div>
                <div className="flex gap-4">
                  <button className="w-12 h-12 flex justify-center items-center rounded-full border border-[#C4C6CD] hover:bg-[#041729] hover:text-[#FDF9EF] transition-colors text-[#041729]">
                    &larr;
                  </button>
                  <button className="w-12 h-12 flex justify-center items-center rounded-full border border-[#C4C6CD] hover:bg-[#041729] hover:text-[#FDF9EF] transition-colors text-[#041729]">
                    &rarr;
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-12 self-stretch">
                {/* Book Item 1 */}
                <div className="flex flex-col gap-4">
                  <div className="w-full aspect-[2/3] bg-gray-200">
                    <img src="/meditations-292846.png" className="w-full h-full object-cover rounded-sm hover:scale-105 transition-all duration-300" alt="Meditations on Light" />
                  </div>
                  <div className="flex flex-col pt-5 gap-2">
                    <h3 className="text-[#041729] font-noto text-[20px] leading-tight">Meditations on Light</h3>
                    <p className="text-[#5F5E5E] text-[12px] font-semibold tracking-[1.2px] uppercase">JULIANNA V. ARIS</p>
                  </div>
                </div>

                {/* Book Item 2 */}
                <div className="flex flex-col gap-4">
                  <div className="w-full aspect-[2/3] bg-gray-200">
                    <img src="/echoes-292846.png" className="w-full h-full object-cover rounded-sm hover:scale-105 transition-all duration-300" alt="Echoes of the Sea" />
                  </div>
                  <div className="flex flex-col pt-5 gap-2">
                    <h3 className="text-[#041729] font-noto text-[20px] leading-tight">Echoes of the Sea</h3>
                    <p className="text-[#5F5E5E] text-[12px] font-semibold tracking-[1.2px] uppercase">SAMUEL NORTH</p>
                  </div>
                </div>

                {/* Book Item 3 */}
                <div className="flex flex-col gap-4">
                  <div className="w-full aspect-[2/3] bg-gray-200">
                    <img src="/fragments-292846.png" className="w-full h-full object-cover rounded-sm hover:scale-105 transition-all duration-300" alt="Fragments of Time" />
                  </div>
                  <div className="flex flex-col pt-5 gap-2">
                    <h3 className="text-[#041729] font-noto text-[20px] leading-tight">Fragments of Time</h3>
                    <p className="text-[#5F5E5E] text-[12px] font-semibold tracking-[1.2px] uppercase">ELIAS THORNE</p>
                  </div>
                </div>

                {/* Book Item 4 */}
                <div className="flex flex-col gap-4">
                  <div className="w-full aspect-[2/3] bg-gray-200">
                    <img src="/inkwell-292846.png" className="w-full h-full object-cover rounded-sm hover:scale-105 transition-all duration-300" alt="The Last Inkwell" />
                  </div>
                  <div className="flex flex-col pt-5 gap-2">
                    <h3 className="text-[#041729] font-noto text-[20px] leading-tight">The Last Inkwell</h3>
                    <p className="text-[#5F5E5E] text-[12px] font-semibold tracking-[1.2px] uppercase">CLARA BEAUVOIR</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* The Literary Journal Section */}
          <div className="flex py-32 px-12 flex-col items-start self-stretch bg-[#FDF9EF]">
            <div className="flex max-w-[1400px] w-full mx-auto flex-col items-center gap-24 self-stretch">

              <div className="flex flex-col gap-4 items-center">
                <p className="text-[#5F5E5E] text-xs font-semibold tracking-[2.4px] uppercase">THE EDITORIAL ARCHIVE</p>
                <h2 className="text-[#041729] font-noto text-[64px] font-normal tracking-[-2.56px] leading-[1]">The Literary Journal</h2>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 self-stretch">
                {/* Featured Article */}
                <div className="col-span-1 lg:col-span-8 flex flex-col gap-8">
                  <div className="w-full aspect-[16/9] bg-gray-200 relative rounded-sm overflow-hidden transition-shadow duration-150 hover:shadow-xl">
                    <img src="/article_main.png" className="w-full h-full object-cover" alt="Article main" />
                    <div className="absolute inset-0 bg-black/5 mix-blend-multiply"></div>
                  </div>
                  <div className="flex flex-col gap-6">
                    <div className="flex gap-4 items-center">
                      <span className="bg-[#041729] text-[#FDF9EF] px-3 py-1 text-[10px] font-bold tracking-[1.5px] uppercase">ESSAY</span>
                      <span className="text-[#C4C6CD] text-[10px] font-bold tracking-[1.5px] uppercase">12 MIN READ</span>
                    </div>
                    <h3 className="text-[#041729] font-noto text-[48px] leading-[1.1] tracking-[-0.96px]">Why We Still Need the Physical Touch of Paper</h3>
                    <p className="text-[#5F5E5E] text-[18px] leading-[1.6] max-w-3xl">In an era of digital transience, the weight of a book and the scent of aged ink provide an anchor to reality. An exploration of tactile memory and the architecture of reading...</p>
                    <button className="flex items-center gap-2 text-[#041729] text-sm font-semibold tracking-[1.4px] uppercase mt-4 border-b border-[#C4C6CD] w-fit pb-1 hover:border-[#041729] transition-colors relative after:content-[''] after:absolute after:bottom-[-1px] after:left-1/2 after:h-[2px] after:w-0 after:-translate-x-1/2 after:bg-[#000000] after:transition-all after:duration-300 hover:after:w-full">
                      READ ARTICLE
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M5 12H19" stroke="#041729" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M12 5L19 12L12 19" stroke="#041729" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Sidebar Articles */}
                <div className="col-span-1 lg:col-span-4 flex flex-col lg:border-l border-[#e5e7eb] lg:pl-16 pt-12 lg:pt-0 border-t lg:border-t-0 gap-12">
                  {/* Small Article 1 */}
                  <div className="flex gap-8 items-start">
                    <div className="w-32 h-32 bg-[#F1EEE4] rounded-sm shrink-0 overflow-hidden transition-shadow duration-150 hover:shadow-xl">
                      <img src="/article1.png" className="w-full h-full object-cover opacity-90 mix-blend-multiply " alt="Article 1" />
                    </div>
                    <div className="flex flex-col gap-3 ">
                      <h4 className="text-[#041729] font-noto text-[20px] leading-tight">The Forgotten Marginalia of 19th Century Poets</h4>
                      <p className="text-[#C4C6CD] text-[10px] font-bold tracking-[1.5px] uppercase">EDITORIAL</p>
                    </div>
                  </div>

                  {/* Small Article 2 */}
                  <div className="flex gap-8 items-start">
                    <div className="w-32 h-32 bg-[#F1EEE4] rounded-sm shrink-0 overflow-hidden transition-shadow duration-150 hover:shadow-xl">
                      <img src="/article2.png" className="w-full h-full object-cover opacity-90 mix-blend-multiply" alt="Article 2" />
                    </div>
                    <div className="flex flex-col gap-3">
                      <h4 className="text-[#041729] font-noto text-[20px] leading-tight">Morning Rituals: The Sanctuary of Early Reading</h4>
                      <p className="text-[#C4C6CD] text-[10px] font-bold tracking-[1.5px] uppercase">PERSPECTIVE</p>
                    </div>
                  </div>

                  {/* Small Article 3 */}
                  <div className="flex gap-8 items-start">
                    <div className="w-32 h-32 bg-[#F1EEE4] rounded-sm shrink-0 overflow-hidden transition-shadow duration-150 hover:shadow-xl">
                      <img src="/article3.png" className="w-full h-full object-cover opacity-90 mix-blend-multiply" alt="Article 3" />
                    </div>
                    <div className="flex flex-col gap-3">
                      <h4 className="text-[#041729] font-noto text-[20px] leading-tight">Finding Stillness in the Middle of the Storm</h4>
                      <p className="text-[#C4C6CD] text-[10px] font-bold tracking-[1.5px] uppercase">REVIEW</p>
                    </div>
                  </div>

                  <button className="w-full py-4 border border-[#041729] text-[#041729] text-sm font-semibold tracking-[1.4px] uppercase my-auto hover:bg-[#041729] hover:text-[#FDF9EF] transition-colors">
                    ACCESS FULL ARCHIVE
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Newsletter Section */}
          <div className="flex py-32 px-12 flex-col items-center justify-center self-stretch bg-[#FDF9EF]">
            <div className="flex w-full max-w-[1400px] mx-auto border border-[#C4C6CD] rounded-xl p-24 flex-col items-center justify-center text-center gap-12 relative overflow-hidden bg-[#F7F3E9]">
              <div className="flex flex-col gap-6 z-10 max-w-2xl items-center">
                <h2 className="text-[#041729] font-noto text-[48px]">Join the Inner Circle</h2>
                <p className="text-[#5F5E5E] text-[16px] leading-[1.6]">Receive our monthly curation of rare finds, exclusive journals, and literary events directly in your inbox. No noise, just literature.</p>
              </div>
              <div className="flex w-full max-w-md z-10 border border-[#C4C6CD] bg-[#FDF9EF] rounded-sm p-1 focus-within:border-2 focus-within:border-[#5F5E5E]">
                <input type="email" placeholder="Email Address" className="flex-1 bg-transparent px-4 py-3 text-[#5F5E5E] outline-none text-sm placeholder:text-[#C4C6CD]" />
                <button className="bg-[#041729] text-[#FDF9EF] px-8 py-3 text-sm font-semibold tracking-[1.4px] uppercase rounded-sm hover:bg-[#FD0000]/60 transition-colors">SUBSCRIBE</button>
              </div>
            </div>
          </div>


        </div>
      </div>

      <div className="block md:hidden w-full bg-[#FDF9EF] pb-[96px]">
        <div className="flex w-full flex-col items-start">{/*Mobile Main*/}
          {/* Mobile Hero Section */}
          <div className="w-full p-4">
            <div className="flex flex-col p-6 gap-6 relative rounded-sm shadow-sm overflow-hidden min-h-[480px] justify-end">
              <div className="absolute inset-0 z-0">
                <img src="/mainbook.png" className="w-full h-full object-cover" alt="Library Background" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#041729] via-[#041729]/60 to-transparent"></div>
              </div>
              <div className="flex flex-col z-10 gap-4">
                <p className="text-[#FDF9EF] text-[10px] font-bold tracking-[1.5px] uppercase">FEATURED EDITORIAL</p>
                <h2 className="text-[#FDF9EF] font-noto text-[40px] leading-[1.1] tracking-[-1px]">The Art of<br />Quiet Reading</h2>
                <p className="text-[#FDF9EF]/90 text-[14px] leading-[1.6]">In an era of endless notifications, the true luxury is a moment of uninterrupted focus.…</p>
                <button className="bg-[#FDF9EF] text-[#041729] px-6 py-3 rounded-md text-[12px] font-semibold tracking-[1.2px] uppercase w-fit mt-2">READ ESSAY</button>
              </div>
            </div>
          </div>

          {/* Mobile Curator's Choice Carousel */}
          <div className="flex flex-col py-8 px-4 gap-6 w-full bg-[#FDF9EF]">
            <div className="flex justify-between items-end">
              <h3 className="text-[#041729] font-noto text-[28px] leading-tight">Curator's Choice</h3>
              <a href="#" className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase pb-1">VIEW ALL</a>
            </div>
            <div className="flex gap-4 overflow-x-auto snap-x pb-4 -mx-4 px-4" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {/* Card 1 */}
              <div className="flex flex-col gap-3 min-w-[160px] max-w-[160px] snap-start">
                <div className="w-full aspect-[2/3] bg-gray-200 shadow-md rounded-sm border border-[#e5e7eb] overflow-hidden">
                  <img src="/book1.png" className="w-full h-full object-cover" alt="The Shadow of the Wind" />
                </div>
                <div className="flex flex-col gap-1">
                  <h4 className="text-[#041729] font-noto text-[16px] leading-tight">The Shadow of the Wind</h4>
                  <p className="text-[#5F5E5E] text-[10px] font-semibold tracking-[1px] uppercase mt-1">Carlos Ruiz Zafón</p>
                </div>
              </div>
              {/* Card 2 */}
              <div className="flex flex-col gap-3 min-w-[160px] max-w-[160px] snap-start">
                <div className="w-full aspect-[2/3] bg-gray-200 shadow-md rounded-sm border border-[#e5e7eb] overflow-hidden">
                  <img src="/book2.png" className="w-full h-full object-cover" alt="If on a winter's night a traveler" />
                </div>
                <div className="flex flex-col gap-1">
                  <h4 className="text-[#041729] font-noto text-[16px] leading-tight">If on a winter's night a traveler</h4>
                  <p className="text-[#5F5E5E] text-[10px] font-semibold tracking-[1px] uppercase mt-1">Italo Calvino</p>
                </div>
              </div>
              {/* Card 3 */}
              <div className="flex flex-col gap-3 min-w-[160px] max-w-[160px] snap-start">
                <div className="w-full aspect-[2/3] bg-gray-200 shadow-md rounded-sm border border-[#e5e7eb] overflow-hidden">
                  <img src="/book3.png" className="w-full h-full object-cover" alt="The Secret History" />
                </div>
                <div className="flex flex-col gap-1">
                  <h4 className="text-[#041729] font-noto text-[16px] leading-tight">The Secret History</h4>
                  <p className="text-[#5F5E5E] text-[10px] font-semibold tracking-[1px] uppercase mt-1">Donna Tartt</p>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile Literary Journal Feed */}
          <div className="flex flex-col py-12 px-4 gap-8 w-full bg-[#F7F3E9]">
            <div className="border-b border-[#E6E2D8] pb-4">
              <h3 className="text-[#041729] font-noto text-[28px] leading-tight">The Literary Journal</h3>
            </div>

            <div className="flex flex-col gap-8">
              {/* Article 1 */}
              <div className="flex flex-col gap-4 bg-[#FDF9EF] rounded-sm shadow-sm overflow-hidden pb-4">
                <div className="w-full aspect-[16/9] bg-gray-200">
                  <img src="/article1.png" className="w-full h-full object-cover" alt="Writing desk" />
                </div>
                <div className="flex flex-col px-4 gap-3 mt-2">
                  <p className="text-[#041729] text-[10px] font-bold tracking-[1.5px] uppercase">ESSAY</p>
                  <h4 className="text-[#041729] font-noto text-[24px] leading-tight">The Marginalia of Memory</h4>
                  <p className="text-[#5F5E5E] text-[14px] leading-[1.6]">Exploring the secret lives of secondhand books and the notes left behind by strangers who read them before us.</p>
                  <p className="text-[#C4C6CD] text-[10px] font-bold tracking-[1.5px] uppercase mt-2">OCT 12, 2023</p>
                </div>
              </div>

              {/* Article 2 */}
              <div className="flex flex-col gap-4 bg-[#FDF9EF] rounded-sm shadow-sm overflow-hidden pb-4">
                <div className="w-full aspect-[16/9] bg-gray-200">
                  <img src="/article2.png" className="w-full h-full object-cover" alt="Open book" />
                </div>
                <div className="flex flex-col px-4 gap-3 mt-2">
                  <p className="text-[#041729] text-[10px] font-bold tracking-[1.5px] uppercase">REVIEW</p>
                  <h4 className="text-[#041729] font-noto text-[24px] leading-tight">Architecture of the Novel</h4>
                  <p className="text-[#5F5E5E] text-[14px] leading-[1.6]">A structural analysis of modern literature's most complex narratives, focusing on how setting becomes character.</p>
                  <p className="text-[#C4C6CD] text-[10px] font-bold tracking-[1.5px] uppercase mt-2">OCT 08, 2023</p>
                </div>
              </div>
            </div>

            <button className="w-full py-4 border border-[#041729] text-[#041729] text-[12px] font-semibold tracking-[1.2px] uppercase rounded-md mt-2 hover:bg-[#041729] hover:text-[#FDF9EF] transition-colors">
              BROWSE ARCHIVE
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
