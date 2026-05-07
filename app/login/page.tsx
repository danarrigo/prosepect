import Image from "next/image";
import Link from "next/link";
import { login } from "../lib/users/actions";


export default function LoginPage() {
  return (
    <main className="min-h-screen relative flex flex-col items-center justify-center bg-[#FDF9EF] overflow-hidden px-6 py-20">
      {/* Background Layer */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/login-bg.png"
          alt="Abstract Book Element"
          fill
          className="object-cover opacity-40"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#FDF9EF]/0 to-[#FDF9EF]" />
      </div>

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-[448px] flex flex-col items-center">
        {/* Header - Logo */}
        <div className="mb-12">
          <h1 className="font-noto text-4xl text-[#041729] tracking-[-0.025em] text-center">
            PROSEPECT
          </h1>
        </div>

        {/* Login Card */}
        <div className="w-full relative">
          <div className="bg-[#FDF9EF]/85 backdrop-blur-[12px] shadow-[0px_12px_32px_0px_rgba(28,28,22,0.06)] rounded-sm p-10 pb-14 w-full relative overflow-hidden">

            {/* Asymmetric accent */}
            <div className="absolute w-24 h-24 bg-[#ECE8DE]/50 rounded-xl -right-6 -top-6" />

            <form className="relative z-10 flex flex-col w-full" action={login}>
              {/* Email Field */}
              <div className="flex flex-col">
                <label htmlFor="email" className="font-noto text-sm text-[#041729] mb-2 tracking-[0.057em]">
                  Email Address
                </label>
                <div className="bg-[#ECE8DE] rounded-sm px-4 py-3">
                  <input
                    type="email"
                    id="email"
                    name="email"
                    placeholder="scholar@example.com"
                    className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#5F5E5E]/50"
                  />
                </div>
              </div>

              {/* Passphrase Field */}
              <div className="flex flex-col mt-8">
                <label htmlFor="passphrase" className="font-noto text-sm text-[#041729] mb-2 tracking-[0.057em]">
                  Passphrase
                </label>
                <div className="bg-[#ECE8DE] rounded-sm px-4 py-3 flex items-center">
                  <input
                    type="password"
                    id="passphrase"
                    name="password"
                    placeholder="••••••••"
                    className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#5F5E5E]/50"
                  />
                  <button type="button" className="ml-2 text-[#5F5E5E] hover:text-[#041729] transition-colors focus:outline-none flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="mt-8 flex items-center justify-center w-full rounded-md py-4 px-8 text-[#FFFFFF] hover:opacity-90 focus:outline-none hover:scale-110 transition-all duration-300"
                style={{
                  background: "radial-gradient(circle at 50% 50%, #041729 0%, #1A2C3E 100%)"
                }}
              >
                <span className="font-noto text-lg mr-3">Enter the Sanctuary</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                </svg>
              </button>

              {/* Footer link */}
              <div className="mt-8 text-center">
                <p className="font-sans text-sm text-[#5F5E5E]">
                  Don&apos;t have an account yet?{" "}
                  <Link href="/signup" className="font-bold text-[#041729] hover:underline">
                    Create one
                  </Link>
                </p>
              </div>
            </form>
          </div>
        </div>

        {/* Footer Quote */}
        <div className="mt-16 flex flex-col items-center gap-6 px-4 text-center w-full">
          <p className="font-noto text-lg text-[#5F5E5E] leading-[29.25px] max-w-[305px] hover:font-semibold transition-all">
            &quot;A reader lives a thousand lives before he dies. The man who never reads lives only one.&quot; — George R.R. Martin
          </p>
          <div className="w-8 h-[1px] bg-[#C4C6CD] opacity-30" />
        </div>
      </div>
    </main>
  );
}
