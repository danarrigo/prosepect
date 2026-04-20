import "./globals.css";

export default function Layout() {
  return (
    <>
      <html lang="en">
        <body>
          <div id="TopAppBar" className="flex md:hidden justify-between py-4 px-6 items-center self-stretch bg-[#FDF9EF] shadow-[0_12px_32px_0_rgba(28,28,22,0.04)]">
            <div className="flex h-10 py-[1px] flex-col justify-center items-start">
              <button className="flex p-2 flex-col items-start appearance-none bg-transparent border-none outline-none">
                <svg width="18" height="12" viewBox="0 0 18 12" fill="#041729">
                  <path d="M0 11.4V9.5H17.1V11.4H0V11.4M0 6.65V4.75H17.1V6.65H0V6.65M0 1.9V0H17.1V1.9H0V1.9" />
                </svg>
              </button>
            </div>
            <h1 className="font-['Liberation_Serif'] text-[#041729] text-2xl/[32px] italic font-normal tracking-[-1.2px]">Athenaeum</h1>
            <div className="flex flex-col h-10 py-[4.8px] justify-center items-start">
              <button id="profileMobile" className="flex flex-col appearance-none outline-none w-8 h-8 p-1 justify-center items-start shrink-0 rounded-xl overflow-hidden">
                <img src="/profilepic.jpg" alt="Profile" className="w-full h-full object-cover" />
              </button>
            </div>
          </div>
        </body>
      </html>
    </>

  )
}