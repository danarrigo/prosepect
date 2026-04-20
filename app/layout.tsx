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
          <div id="TopDesktopBar" className="hidden md:flex w-full flex-col items-start bg-[#FDF9EF]">
            <div className="flex max-w-[1920px] py-6 px-12 justify-between items-center self-stretch">
              <div className="flex items-center gap-12">
                <a className="flex flex-col items-start"><p className="font-['Liberation_Serif'] text-[#041729] text-2xl/[32px] italic font-normal">The Private Library</p></a>
                <ul className="flex items-center gap-8">
                  <li><a className="flex py-1 flex-col items-start border-b border-[#041729]"><p className="text-[#041729] text-base/[26px] not-italic font-medium tracking-[-0.4px]">Curated</p></a></li>
                  <li><a className="flex flex-col items-start"><p className="text-[#5F5E5E] text-base/[26px] not-italic font-normal tracking-[-0.4px]">Library</p></a></li>
                  <li><a className="flex flex-col items-start"><p className="text-[#5F5E5E] text-base/[26px] not-italic font-normal tracking-[-0.4px]">Archives</p></a></li>
                  <li><a className="flex flex-col items-start"><p className="text-[#5F5E5E] text-base/[26px] not-italic font-normal tracking-[-0.4px]">Notebook</p></a></li>
                </ul>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex py-2 px-4 items-center rounded-sm bg-[#ECE8DE]">
                  <div className="flex pr-2 flex-col items-start">
                    <svg width="10" height="10" fill="#5F5E5E" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9.41408 10.0288L5.7503 6.36503C5.45864 6.60584 5.12322 6.7943 4.74405 6.93042C4.36488 7.06653 3.97263 7.13458 3.56729 7.13458C2.57114 7.13458 1.72756 6.78907 1.03653 6.09805C0.345511 5.40703 0 4.56344 0 3.56729C0 2.57114 0.345511 1.72756 1.03653 1.03653C1.72756 0.345511 2.57114 0 3.56729 0C4.56344 0 5.40703 0.345511 6.09805 1.03653C6.78907 1.72756 7.13458 2.57114 7.13458 3.56729C7.13458 3.98385 7.06466 4.38171 6.92481 4.76088C6.78496 5.14005 6.59836 5.46985 6.36503 5.7503L10.0288 9.41408L9.41408 10.0288ZM3.56729 6.2596C4.3189 6.2596 4.95552 5.99879 5.47715 5.47715C5.99879 4.95552 6.2596 4.3189 6.2596 3.56729C6.2596 2.81569 5.99879 2.17907 5.47715 1.65743C4.95552 1.1358 4.3189 0.874979 3.56729 0.874979C2.81569 0.874979 2.17907 1.1358 1.65743 1.65743C1.1358 2.17907 0.874979 2.81569 0.874979 3.56729C0.874979 4.3189 1.1358 4.95552 1.65743 5.47715C2.17907 5.99879 2.81569 6.2596 3.56729 6.2596Z" fill="#5F5E5E" />
                    </svg>
                  </div>
                  <div className="flex w-[192px] py-2 px-3">
                    <div className="flex flex-col items-start self-stretch">
                      <input type="text" placeholder="Search the archives..." className="self-stretch text-[#74777D] text-sm not-italic font-normal leading-[normal]"></input>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col justify-center items-center">
                  <button className="flex justify-center items-start">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#041729">
                      <path d="M4.40382 18.4904C5.46632 17.7019 6.62377 17.0793 7.87617 16.6226C9.12856 16.1658 10.4615 15.9375 11.875 15.9375C13.2884 15.9375 14.6213 16.1658 15.8737 16.6226C17.1261 17.0793 18.2836 17.7019 19.3461 18.4904C20.1233 17.6362 20.7391 16.6474 21.1935 15.524C21.6478 14.4006 21.875 13.1843 21.875 11.875C21.875 9.10412 20.901 6.74475 18.9531 4.79683C17.0052 2.84891 14.6458 1.87495 11.875 1.87495C9.10412 1.87495 6.74475 2.84891 4.79683 4.79683C2.84891 6.74475 1.87495 9.10412 1.87495 11.875C1.87495 13.1843 2.10212 14.4006 2.55645 15.524C3.01078 16.6474 3.62657 17.6362 4.40382 18.4904ZM11.875 12.8124C10.7339 12.8124 9.7716 12.4206 8.98795 11.637C8.2043 10.8533 7.81248 9.89097 7.81248 8.74995C7.81248 7.60893 8.2043 6.6466 8.98795 5.86295C9.7716 5.0793 10.7339 4.68748 11.875 4.68748C13.016 4.68748 13.9783 5.0793 14.762 5.86295C15.5456 6.6466 15.9374 7.60893 15.9374 8.74995C15.9374 9.89097 15.5456 10.8533 14.762 11.637C13.9783 12.4206 13.016 12.8124 11.875 12.8124ZM11.875 23.7499C10.2259 23.7499 8.67905 23.4398 7.23435 22.8196C5.78964 22.1994 4.53283 21.3549 3.46393 20.286C2.39502 19.2171 1.55047 17.9603 0.930285 16.5156C0.310095 15.0709 0 13.524 0 11.875C0 10.2259 0.310095 8.67905 0.930285 7.23435C1.55047 5.78964 2.39502 4.53283 3.46393 3.46393C4.53283 2.39502 5.78964 1.55047 7.23435 0.930285C8.67905 0.310095 10.2259 0 11.875 0C13.524 0 15.0709 0.310095 16.5156 0.930285C17.9603 1.55047 19.2171 2.39502 20.286 3.46393C21.3549 4.53283 22.1994 5.78964 22.8196 7.23435C23.4398 8.67905 23.7499 10.2259 23.7499 11.875C23.7499 13.524 23.4398 15.0709 22.8196 16.5156C22.1994 17.9603 21.3549 19.2171 20.286 20.286C19.2171 21.3549 17.9603 22.1994 16.5156 22.8196C15.0709 23.4398 13.524 23.7499 11.875 23.7499ZM11.875 21.875C13.0032 21.875 14.0909 21.6935 15.1382 21.3305C16.1855 20.9675 17.1154 20.4599 17.9279 19.8076C17.1154 19.1794 16.1975 18.6898 15.1742 18.3389C14.151 17.9879 13.0512 17.8124 11.875 17.8124C10.6987 17.8124 9.5969 17.9859 8.56965 18.3329C7.54241 18.6798 6.62654 19.1714 5.82205 19.8076C6.63455 20.4599 7.56444 20.9675 8.61172 21.3305C9.659 21.6935 10.7467 21.875 11.875 21.875ZM11.875 10.9375C12.4968 10.9375 13.0168 10.7283 13.4351 10.3101C13.8533 9.89179 14.0625 9.37175 14.0625 8.74995C14.0625 8.12815 13.8533 7.60812 13.4351 7.18984C13.0168 6.77157 12.4968 6.56243 11.875 6.56243C11.2532 6.56243 10.7331 6.77157 10.3148 7.18984C9.89657 7.60812 9.68743 8.12815 9.68743 8.74995C9.68743 9.37175 9.89657 9.89179 10.3148 10.3101C10.7331 10.7283 11.2532 10.9375 11.875 10.9375Z" fill="#041729" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    </>

  )
}