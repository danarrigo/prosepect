import "./globals.css";

import localFont from "next/font/local";

import { Noto_Serif } from "next/font/google";

const notoSerif = Noto_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-noto-serif",
});

const liberationSerif = localFont({
  src: "../public/fonts/LiberationSerif-Regular.ttf",
  variable: "--font-liberation-serif",
});

export default function Layout({ children }: { children: React.ReactNode; }) {
  return (
    <html lang="en" className={`${liberationSerif.variable} ${notoSerif.variable}`}>
      <body>
        <div id="TopAppBar" className="flex md:hidden justify-between py-4 px-6 items-center self-stretch bg-[#FDF9EF] shadow-[0_12px_32px_0_rgba(28,28,22,0.04)]">{/*Mobile Top Nav Bar*/}
          <div className="flex h-10 py-[1px] flex-col justify-center items-start">
            <button className="flex p-2 flex-col items-start appearance-none bg-transparent border-none outline-none">
              <svg width="18" height="12" viewBox="0 0 18 12" fill="#041729">
                <path d="M0 11.4V9.5H17.1V11.4H0V11.4M0 6.65V4.75H17.1V6.65H0V6.65M0 1.9V0H17.1V1.9H0V1.9" />
              </svg>
            </button>
          </div>
          <h1 className="font-liberation text-[#041729] text-2xl/[32px] italic font-normal tracking-[-1.2px]">Athenaeum</h1>
          <div className="flex flex-col h-10 py-[4.8px] justify-center items-start">
            <button id="profileMobile" className="flex flex-col appearance-none outline-none w-8 h-8 p-1 justify-center items-start shrink-0 rounded-xl overflow-hidden">
              <img src="/profilepic.jpg" alt="Profile" className="w-full h-full object-cover" />
            </button>
          </div>
        </div>
        <div id="TopDesktopBar" className="hidden md:flex w-full flex-col items-start bg-[#FDF9EF]">{/*Desktop Top Nav Bar*/}
          <div className="flex max-w-[1920px] py-6 px-12 justify-between items-center self-stretch">
            <div className="flex items-center gap-12">
              <a href="/" className="flex flex-col items-start"><p className="font-liberation text-[#041729] text-2xl/[32px] italic font-normal hover:font-semibold">The Private Library</p></a>
              <ul className="flex items-center gap-8">
                <li><a href="/curated" className="flex flex-col items-start hover:py-1 hover:border-b hover:border-[#041729]"><p className="text-[#5F5E5E] text-base/[26px] not-italic font-normal tracking-[-0.4px] hover:font-medium hover:text-[#041729]">Curated</p></a></li>
                <li><a href="/library" className="flex flex-col items-start hover:py-1 hover:border-b hover:border-[#041729]"><p className="text-[#5F5E5E] text-base/[26px] not-italic font-normal tracking-[-0.4px] hover:font-medium hover:text-[#041729]">Library</p></a></li>
                <li><a href="/archives" className="flex flex-col items-start hover:py-1 hover:border-b hover:border-[#041729]"><p className="text-[#5F5E5E] text-base/[26px] not-italic font-normal tracking-[-0.4px] hover:font-medium hover:text-[#041729]">Archives</p></a></li>
                <li><a href="/notebook" className="flex flex-col items-start hover:py-1 hover:border-b hover:border-[#041729]"><p className="text-[#5F5E5E] text-base/[26px] not-italic font-normal tracking-[-0.4px] hover:font-medium hover:text-[#041729]">Notebook</p></a></li>
              </ul>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex py-2 px-4 items-center rounded-sm bg-[#ECE8DE] focus-within:ring-1 focus-within:ring-[#041729] transition-all">
                <div className="flex pr-2 flex-col items-start">
                  <svg width="10" height="10" fill="#5F5E5E" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9.41408 10.0288L5.7503 6.36503C5.45864 6.60584 5.12322 6.7943 4.74405 6.93042C4.36488 7.06653 3.97263 7.13458 3.56729 7.13458C2.57114 7.13458 1.72756 6.78907 1.03653 6.09805C0.345511 5.40703 0 4.56344 0 3.56729C0 2.57114 0.345511 1.72756 1.03653 1.03653C1.72756 0.345511 2.57114 0 3.56729 0C4.56344 0 5.40703 0.345511 6.09805 1.03653C6.78907 1.72756 7.13458 2.57114 7.13458 3.56729C7.13458 3.98385 7.06466 4.38171 6.92481 4.76088C6.78496 5.14005 6.59836 5.46985 6.36503 5.7503L10.0288 9.41408L9.41408 10.0288ZM3.56729 6.2596C4.3189 6.2596 4.95552 5.99879 5.47715 5.47715C5.99879 4.95552 6.2596 4.3189 6.2596 3.56729C6.2596 2.81569 5.99879 2.17907 5.47715 1.65743C4.95552 1.1358 4.3189 0.874979 3.56729 0.874979C2.81569 0.874979 2.17907 1.1358 1.65743 1.65743C1.1358 2.17907 0.874979 2.81569 0.874979 3.56729C0.874979 4.3189 1.1358 4.95552 1.65743 5.47715C2.17907 5.99879 2.81569 6.2596 3.56729 6.2596Z" fill="#5F5E5E" />
                  </svg>
                </div>
                <div className="flex w-[192px]">
                  <input type="text" placeholder="Search the archives..." className="w-full bg-transparent outline-none text-[#041729] text-sm not-italic font-normal leading-[normal] placeholder-[#74777D]"></input>
                </div>
              </div>
              <div className="flex flex-col justify-center items-center">
                <a href="/profile" className="flex justify-center items-start">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#041729">
                    <path d="M4.40382 18.4904C5.46632 17.7019 6.62377 17.0793 7.87617 16.6226C9.12856 16.1658 10.4615 15.9375 11.875 15.9375C13.2884 15.9375 14.6213 16.1658 15.8737 16.6226C17.1261 17.0793 18.2836 17.7019 19.3461 18.4904C20.1233 17.6362 20.7391 16.6474 21.1935 15.524C21.6478 14.4006 21.875 13.1843 21.875 11.875C21.875 9.10412 20.901 6.74475 18.9531 4.79683C17.0052 2.84891 14.6458 1.87495 11.875 1.87495C9.10412 1.87495 6.74475 2.84891 4.79683 4.79683C2.84891 6.74475 1.87495 9.10412 1.87495 11.875C1.87495 13.1843 2.10212 14.4006 2.55645 15.524C3.01078 16.6474 3.62657 17.6362 4.40382 18.4904ZM11.875 12.8124C10.7339 12.8124 9.7716 12.4206 8.98795 11.637C8.2043 10.8533 7.81248 9.89097 7.81248 8.74995C7.81248 7.60893 8.2043 6.6466 8.98795 5.86295C9.7716 5.0793 10.7339 4.68748 11.875 4.68748C13.016 4.68748 13.9783 5.0793 14.762 5.86295C15.5456 6.6466 15.9374 7.60893 15.9374 8.74995C15.9374 9.89097 15.5456 10.8533 14.762 11.637C13.9783 12.4206 13.016 12.8124 11.875 12.8124ZM11.875 23.7499C10.2259 23.7499 8.67905 23.4398 7.23435 22.8196C5.78964 22.1994 4.53283 21.3549 3.46393 20.286C2.39502 19.2171 1.55047 17.9603 0.930285 16.5156C0.310095 15.0709 0 13.524 0 11.875C0 10.2259 0.310095 8.67905 0.930285 7.23435C1.55047 5.78964 2.39502 4.53283 3.46393 3.46393C4.53283 2.39502 5.78964 1.55047 7.23435 0.930285C8.67905 0.310095 10.2259 0 11.875 0C13.524 0 15.0709 0.310095 16.5156 0.930285C17.9603 1.55047 19.2171 2.39502 20.286 3.46393C21.3549 4.53283 22.1994 5.78964 22.8196 7.23435C23.4398 8.67905 23.7499 10.2259 23.7499 11.875C23.7499 13.524 23.4398 15.0709 22.8196 16.5156C22.1994 17.9603 21.3549 19.2171 20.286 20.286C19.2171 21.3549 17.9603 22.1994 16.5156 22.8196C15.0709 23.4398 13.524 23.7499 11.875 23.7499ZM11.875 21.875C13.0032 21.875 14.0909 21.6935 15.1382 21.3305C16.1855 20.9675 17.1154 20.4599 17.9279 19.8076C17.1154 19.1794 16.1975 18.6898 15.1742 18.3389C14.151 17.9879 13.0512 17.8124 11.875 17.8124C10.6987 17.8124 9.5969 17.9859 8.56965 18.3329C7.54241 18.6798 6.62654 19.1714 5.82205 19.8076C6.63455 20.4599 7.56444 20.9675 8.61172 21.3305C9.659 21.6935 10.7467 21.875 11.875 21.875ZM11.875 10.9375C12.4968 10.9375 13.0168 10.7283 13.4351 10.3101C13.8533 9.89179 14.0625 9.37175 14.0625 8.74995C14.0625 8.12815 13.8533 7.60812 13.4351 7.18984C13.0168 6.77157 12.4968 6.56243 11.875 6.56243C11.2532 6.56243 10.7331 6.77157 10.3148 7.18984C9.89657 7.60812 9.68743 8.12815 9.68743 8.74995C9.68743 9.37175 9.89657 9.89179 10.3148 10.3101C10.7331 10.7283 11.2532 10.9375 11.875 10.9375Z" fill="#041729" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
        {children}
        <ul className="flex w-full pt-[12px] px-[28px] pb-[24px] items-center gap-6 fixed z-50 left-0 bottom-0 justify-around bg-[rgba(253,249,239,0.90)] rounded-t-lg rounded-r-lg flex-nowrap overflow-x-auto md:hidden">{/*Mobile bottom bar*/}
          <li><button className="flex flex-col justify-center items-center gap-[-1px] opacity-[0.7]"><span className="inline-flex pb-[4px] flex-col items-start"><span className="inline-flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="20" viewBox="0 0 22 20" fill="#5F5E5E">
            <path d="M11 19.5C10.2 18.8667 9.33333 18.375 8.4 18.025C7.46667 17.675 6.5 17.5 5.5 17.5C4.8 17.5 4.1125 17.5917 3.4375 17.775C2.7625 17.9583 2.11667 18.2167 1.5 18.55C1.15 18.7333 0.8125 18.725 0.4875 18.525C0.1625 18.325 0 18.0333 0 17.65V5.6C0 5.41667 0.0458333 5.24167 0.1375 5.075C0.229167 4.90833 0.366667 4.78333 0.55 4.7C1.31667 4.3 2.11667 4 2.95 3.8C3.78333 3.6 4.63333 3.5 5.5 3.5C6.46667 3.5 7.4125 3.625 8.3375 3.875C9.2625 4.125 10.15 4.5 11 5V17.1C11.85 16.5667 12.7417 16.1667 13.675 15.9C14.6083 15.6333 15.55 15.5 16.5 15.5C17.1 15.5 17.6875 15.55 18.2625 15.65C18.8375 15.75 19.4167 15.9 20 16.1V4.1C20.25 4.18333 20.4958 4.27083 20.7375 4.3625C20.9792 4.45417 21.2167 4.56667 21.45 4.7C21.6333 4.78333 21.7708 4.90833 21.8625 5.075C21.9542 5.24167 22 5.41667 22 5.6V17.65C22 18.0333 21.8375 18.325 21.5125 18.525C21.1875 18.725 20.85 18.7333 20.5 18.55C19.8833 18.2167 19.2375 17.9583 18.5625 17.775C17.8875 17.5917 17.2 17.5 16.5 17.5C15.5 17.5 14.5333 17.675 13.6 18.025C12.6667 18.375 11.8 18.8667 11 19.5ZM13 14.5V5L18 0V10L13 14.5ZM9 16.125V6.225C8.45 5.99167 7.87917 5.8125 7.2875 5.6875C6.69583 5.5625 6.1 5.5 5.5 5.5C4.88333 5.5 4.28333 5.55833 3.7 5.675C3.11667 5.79167 2.55 5.96667 2 6.2V16.125C2.58333 15.9083 3.1625 15.75 3.7375 15.65C4.3125 15.55 4.9 15.5 5.5 15.5C6.1 15.5 6.6875 15.55 7.2625 15.65C7.8375 15.75 8.41667 15.9083 9 16.125ZM9 16.125V6.225V16.125Z" fill="#5F5E5E" />
          </svg></span></span><span className="inline-flex flex-col items-center"><p className="text-[#5F5E5E] text-center text-[11px]/[16.5px] not-italic font-medium tracking-[1.1px] uppercase">CURATED</p></span></button></li>
          <li><button className="flex px-2 py-5 flex-col justify-center items-center gap-[-1px] rounded-xl bg-[#E6E2D8]"><span className="flex pb-1 flex-col items-start"><span className="flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="#041729">
            <path d="M2 20C1.45 20 0.979167 19.8042 0.5875 19.4125C0.195833 19.0208 0 18.55 0 18V4H2V18H16V20H2ZM6 16C5.45 16 4.97917 15.8042 4.5875 15.4125C4.19583 15.0208 4 14.55 4 14V2C4 1.45 4.19583 0.979167 4.5875 0.5875C4.97917 0.195833 5.45 0 6 0H18C18.55 0 19.0208 0.195833 19.4125 0.5875C19.8042 0.979167 20 1.45 20 2V14C20 14.55 19.8042 15.0208 19.4125 15.4125C19.0208 15.8042 18.55 16 18 16H6ZM11 9L13.5 7.5L16 9V2H11V9Z" fill="#041729" />
          </svg></span></span><span className="flex flex-col items-center"><p className="text-[#041729] align-center text-[11px]/[16.5px] not-italic font-medium tracking-[1.1px] uppercase">Library</p></span></button></li>
          <li><button className="flex flex-col justify-center items-center gap-[-1px] opacity-[0.7]"><span className="inline-flex pb-[4px] flex-col items-start"><span className="inline-flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="#5F5E5E">
            <path d="M16.6 18L10.3 11.7C9.8 12.1 9.225 12.4167 8.575 12.65C7.925 12.8833 7.23333 13 6.5 13C4.68333 13 3.14583 12.3708 1.8875 11.1125C0.629167 9.85417 0 8.31667 0 6.5C0 4.68333 0.629167 3.14583 1.8875 1.8875C3.14583 0.629167 4.68333 0 6.5 0C8.31667 0 9.85417 0.629167 11.1125 1.8875C12.3708 3.14583 13 4.68333 13 6.5C13 7.23333 12.8833 7.925 12.65 8.575C12.4167 9.225 12.1 9.8 11.7 10.3L18 16.6L16.6 18ZM6.5 11C7.75 11 8.8125 10.5625 9.6875 9.6875C10.5625 8.8125 11 7.75 11 6.5C11 5.25 10.5625 4.1875 9.6875 3.3125C8.8125 2.4375 7.75 2 6.5 2C5.25 2 4.1875 2.4375 3.3125 3.3125C2.4375 4.1875 2 5.25 2 6.5C2 7.75 2.4375 8.8125 3.3125 9.6875C4.1875 10.5625 5.25 11 6.5 11Z" fill="#5F5E5E" />
          </svg></span></span><span className="inline-flex flex-col items-center"><p className="text-[#5F5E5E] text-center text-[11px]/[16.5px] not-italic font-medium tracking-[1.1px] uppercase">SEARCH</p></span></button></li>
          <li><button className="flex flex-col justify-center items-center gap-[-1px] opacity-[0.7]"><span className="inline-flex pb-[4px] flex-col items-start"><span className="inline-flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 8C6.9 8 5.95833 7.60833 5.175 6.825C4.39167 6.04167 4 5.1 4 4C4 2.9 4.39167 1.95833 5.175 1.175C5.95833 0.391667 6.9 0 8 0C9.1 0 10.0417 0.391667 10.825 1.175C11.6083 1.95833 12 2.9 12 4C12 5.1 11.6083 6.04167 10.825 6.825C10.0417 7.60833 9.1 8 8 8ZM0 16V13.2C0 12.6333 0.145833 12.1125 0.4375 11.6375C0.729167 11.1625 1.11667 10.8 1.6 10.55C2.63333 10.0333 3.68333 9.64583 4.75 9.3875C5.81667 9.12917 6.9 9 8 9C9.1 9 10.1833 9.12917 11.25 9.3875C12.3167 9.64583 13.3667 10.0333 14.4 10.55C14.8833 10.8 15.2708 11.1625 15.5625 11.6375C15.8542 12.1125 16 12.6333 16 13.2V16H0ZM2 14H14V13.2C14 13.0167 13.9542 12.85 13.8625 12.7C13.7708 12.55 13.65 12.4333 13.5 12.35C12.6 11.9 11.6917 11.5625 10.775 11.3375C9.85833 11.1125 8.93333 11 8 11C7.06667 11 6.14167 11.1125 5.225 11.3375C4.30833 11.5625 3.4 11.9 2.5 12.35C2.35 12.4333 2.22917 12.55 2.1375 12.7C2.04583 12.85 2 13.0167 2 13.2V14ZM8 6C8.55 6 9.02083 5.80417 9.4125 5.4125C9.80417 5.02083 10 4.55 10 4C10 3.45 9.80417 2.97917 9.4125 2.5875C9.02083 2.19583 8.55 2 8 2C7.45 2 6.97917 2.19583 6.5875 2.5875C6.19583 2.97917 6 3.45 6 4C6 4.55 6.19583 5.02083 6.5875 5.4125C6.97917 5.80417 7.45 6 8 6Z" fill="#5F5E5E" />
          </svg></span></span><span className="inline-flex flex-col items-center"><p className="text-[#5F5E5E] text-center text-[11px]/[16.5px] not-italic font-medium tracking-[1.1px] uppercase">PROFILE</p></span></button></li>
        </ul>
        <div className="hidden md:flex w-full flex-col items-start bg-[#F7F3E9] justify-end">{/*Desktop bottom bar*/}
          <div className="flex max-w-[1920px] py-16 px-12 justify-around items-center self-stretch">
            <div className="flex flex-col items-start gap-2">
              <div className="flex flex-col items-start self-stretch">
                <p className="text-[#041729] font-liberation text-lg not-italic font-normal">The Private Library</p>
              </div>
              <div className="flex flex-col items-start self-stretch">
                <p className="text-[#5F5E5E] text-[10px]/[15px] font-normal not-italic tracking-[0.8px] uppercase">© 2024 THE PRIVATE LIBRARY. A SANCTUARY FOR THE WRITTEN WORD.</p>
              </div>
            </div>
            <ul className="flex justify-center items-start gap-12">
              <li className="flex flex-col items-start self-stretch"><a><p className="text-[#5F5E5E] text-[12px]/[16px] not-italic font-normal tracking-[0.8px] uppercase hover:font-bold transition-all cursor-pointer">THE CURATOR'S NOTE</p></a></li>
              <li className="flex flex-col items-start self-stretch"><a><p className="text-[#5F5E5E] text-[12px]/[16px] not-italic font-normal tracking-[0.8px] uppercase hover:font-bold transition-all cursor-pointer">PRIVACY</p></a></li>
              <li className="flex flex-col items-start self-stretch"><a><p className="text-[#5F5E5E] text-[12px]/[16px] not-italic font-normal tracking-[0.8px] uppercase hover:font-bold transition-all cursor-pointer">TERMS OF SERVICE</p></a></li>
              <li className="flex flex-col items-start self-stretch"><a><p className="text-[#5F5E5E] text-[12px]/[16px] not-italic font-normal tracking-[0.8px] uppercase hover:font-bold transition-all cursor-pointer">COLOPHON</p></a></li>
            </ul>
            <ul className="flex items-start gap-6">
              <li className="flex flex-col items-start self-stretch"><a><svg xmlns="http://www.w3.org/2000/svg" width="14" height="15" viewBox="0 0 15 16" fill="#041729">
                <path d="M11.9211 15.8333C11.2974 15.8333 10.7679 15.6151 10.3325 15.1789C9.89714 14.7426 9.67946 14.2129 9.67946 13.5897C9.67946 13.5064 9.70831 13.3039 9.766 12.9823L3.83972 9.49354C3.63886 9.70187 3.40025 9.86507 3.12388 9.98312C2.84752 10.1012 2.55141 10.1602 2.23556 10.1602C1.61457 10.1602 1.08673 9.94119 0.652038 9.50316C0.217346 9.06513 0 8.53629 0 7.91664C0 7.29698 0.217346 6.76814 0.652038 6.33011C1.08673 5.89208 1.61457 5.67307 2.23556 5.67307C2.55141 5.67307 2.84752 5.73209 3.12388 5.85015C3.40025 5.9682 3.63886 6.1314 3.83972 6.33973L9.766 2.85896C9.73288 2.75639 9.71018 2.65597 9.69789 2.55767C9.68561 2.45938 9.67946 2.35468 9.67946 2.24357C9.67946 1.62036 9.89777 1.09063 10.3344 0.654376C10.771 0.218125 11.3012 0 11.9249 0C12.5487 0 13.0782 0.218308 13.5136 0.654925C13.9489 1.09154 14.1666 1.62172 14.1666 2.24546C14.1666 2.86919 13.9485 3.39874 13.5122 3.8341C13.076 4.26946 12.5462 4.48714 11.923 4.48714C11.6057 4.48714 11.3106 4.42678 11.0376 4.30605C10.7647 4.18533 10.5277 4.0208 10.3269 3.81246L4.4006 7.30125C4.43372 7.40381 4.45643 7.50424 4.46871 7.60253C4.481 7.70082 4.48714 7.80552 4.48714 7.91664C4.48714 8.02775 4.481 8.13245 4.46871 8.23074C4.45643 8.32903 4.43372 8.42946 4.4006 8.53202L10.3269 12.0208C10.5277 11.8125 10.7647 11.6479 11.0376 11.5272C11.3106 11.4065 11.6057 11.3461 11.923 11.3461C12.5462 11.3461 13.076 11.5644 13.5122 12.0011C13.9485 12.4377 14.1666 12.9678 14.1666 13.5916C14.1666 14.2153 13.9483 14.7449 13.5117 15.1802C13.0751 15.6156 12.5449 15.8333 11.9211 15.8333ZM11.9258 14.5833C12.2082 14.5833 12.4439 14.4878 12.633 14.2968C12.8221 14.1059 12.9166 13.8692 12.9166 13.5869C12.9166 13.3046 12.8217 13.0689 12.6318 12.8798C12.4419 12.6907 12.2066 12.5961 11.9258 12.5961C11.6451 12.5961 11.4089 12.6911 11.2171 12.881C11.0253 13.0709 10.9294 13.3062 10.9294 13.5869C10.9294 13.8676 11.0249 14.1039 11.2159 14.2956C11.4069 14.4874 11.6435 14.5833 11.9258 14.5833ZM2.23556 8.91024C2.51935 8.91024 2.75723 8.81435 2.94921 8.62257C3.14118 8.4308 3.23717 8.19549 3.23717 7.91664C3.23717 7.63779 3.14118 7.40247 2.94921 7.2107C2.75723 7.01892 2.51935 6.92303 2.23556 6.92303C1.95631 6.92303 1.72223 7.01892 1.53333 7.2107C1.34442 7.40247 1.24997 7.63779 1.24997 7.91664C1.24997 8.19549 1.34442 8.4308 1.53333 8.62257C1.72223 8.81435 1.95631 8.91024 2.23556 8.91024ZM11.923 3.23717C12.2019 3.23717 12.4372 3.14195 12.629 2.95151C12.8207 2.76107 12.9166 2.52509 12.9166 2.24357C12.9166 1.96205 12.8221 1.72607 12.633 1.53563C12.4439 1.34519 12.2082 1.24997 11.9258 1.24997C11.6435 1.24997 11.4069 1.34492 11.2159 1.53482C11.0249 1.72472 10.9294 1.96004 10.9294 2.24076C10.9294 2.52148 11.0253 2.75773 11.2171 2.94951C11.4089 3.14128 11.6442 3.23717 11.923 3.23717Z" fill="#041729" />
              </svg></a></li>
              <li className="lex flex-col items-start self-stretch"><a><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="#041729">
                <path d="M1.34613 13.3333C0.973273 13.3333 0.655704 13.2012 0.393422 12.937C0.131141 12.6728 0 12.3553 0 11.9843C0 11.6133 0.132086 11.2967 0.396259 11.0344C0.660432 10.7722 0.978001 10.641 1.34897 10.641C1.71993 10.641 2.03656 10.7722 2.29884 11.0344C2.56112 11.2967 2.69226 11.6143 2.69226 11.9871C2.69226 12.36 2.56112 12.6776 2.29884 12.9398C2.03656 13.2021 1.71899 13.3333 1.34613 13.3333ZM11.4743 13.3333C11.4743 11.735 11.1738 10.2426 10.5728 8.85614C9.97175 7.46967 9.15216 6.25737 8.114 5.21923C7.07585 4.18109 5.86353 3.3615 4.47704 2.76047C3.09056 2.15944 1.59821 1.85893 0 1.85893V0C1.85469 0 3.58679 0.348022 5.19629 1.04407C6.80579 1.74011 8.21631 2.6939 9.42784 3.90543C10.6394 5.11696 11.5932 6.52694 12.2892 8.13535C12.9853 9.74376 13.3333 11.4764 13.3333 13.3333H11.4743ZM6.66667 13.3333C6.66667 12.4027 6.49306 11.5381 6.14583 10.7395C5.79861 9.94091 5.31944 9.23605 4.70833 8.62494C4.09722 8.01383 3.39236 7.53466 2.59375 7.18744C1.79514 6.84022 0.930556 6.66661 0 6.66661V4.80768C1.18696 4.80768 2.29513 5.0299 3.3245 5.47434C4.35388 5.91878 5.25555 6.52873 6.02953 7.30417C6.8035 8.07962 7.41301 8.98108 7.85804 10.0085C8.30308 11.036 8.52559 12.1443 8.52559 13.3333H6.66667Z" fill="#041729" />
              </svg></a></li>
            </ul>
          </div>
        </div>
      </body>
    </html >
  )
}