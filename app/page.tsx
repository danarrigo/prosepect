

export default function Home() {
  return (
    <div className="hidden md:block h-[3277px] w-full bg-[#FDF9EF]">
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
                <button className="flex py-5 px-10 flex-col justify-center items-center rounded-md bg-[#041729] text-[#FDF9EF] align-center text-sm not-italic font-semibold tracking-[1.4px] uppercase">EXPLORE COLLECTION</button>
                <button className="flex pb-1 flex-col justify-center items-center border-b border-solid border-b-[#C4C6CD] text-[#041729] align-center text-sm not-italic font-semibold tracking-[1.4px] uppercase">
                  VIEW JOURNALS
                </button>
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
      </div>
    </div>
  )
}
