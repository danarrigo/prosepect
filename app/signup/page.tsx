import Image from "next/image";
import Link from "next/link";
import { signUp } from "../lib/users/actions"

export default function SignupPage() {
  return (
    <main className="min-h-screen relative flex flex-col items-center justify-center bg-[#FDF9EF] overflow-hidden px-4 py-20">
      {/* Background Layers */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/signup-bg1.png"
          alt="Vintage paper texture"
          fill
          className="object-cover opacity-20"
          priority
        />
        <Image
          src="/signup-bg2.png"
          alt="Artistic overlay texture"
          fill
          className="object-cover opacity-10"
          priority
        />
      </div>

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-[512px] flex flex-col items-center gap-12">
        {/* Header */}
        <div className="flex flex-col items-center gap-4">
          <h1 className="font-noto text-4xl text-[#041729] tracking-[-0.05em] text-center">
            Prosepect
          </h1>
          <p className="font-noto text-lg text-[#5F5E5E] tracking-[-0.025em] text-center">
            The Digital Curator
          </p>
        </div>

        {/* Registration Card */}
        <div className="w-full bg-white/80 backdrop-blur-[12px] shadow-[0px_12px_32px_0px_rgba(28,28,22,0.06)] rounded-sm p-8 sm:p-14 flex flex-col gap-10">

          <form className="flex flex-col w-full gap-8" action={signUp}>
            {/* Full Name Field */}
            <div className="flex flex-col gap-2">
              <label htmlFor="fullName" className="font-noto text-sm text-[#041729] tracking-[0.025em]">
                Full Name
              </label>
              <div className="bg-[#ECE8DE] rounded-sm px-4 py-[13px]">
                <input
                  type="text"
                  id="fullName"
                  name="fullName"
                  placeholder="J. Doe"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                />
              </div>
            </div>

            {/* Email Field */}
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="font-noto text-sm text-[#041729] tracking-[0.025em]">
                Email Address
              </label>
              <div className="bg-[#ECE8DE] rounded-sm px-4 py-[13px]">
                <input
                  type="email"
                  id="email"
                  name="email"
                  placeholder="j.doe@example.com"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                />
              </div>
            </div>

            {/* Passphrase Field */}
            <div className="flex flex-col gap-2">
              <label htmlFor="passphrase" className="font-noto text-sm text-[#041729] tracking-[0.025em]">
                Passphrase
              </label>
              <div className="bg-[#ECE8DE] rounded-sm px-4 py-[13px]">
                <input
                  type="password"
                  id="passphrase"
                  name="password"
                  placeholder="••••••••"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="flex items-center justify-center w-full rounded-sm py-4 px-6 text-[#FFFFFF] shadow-[0px_12px_32px_0px_rgba(28,28,22,0.06)] hover:opacity-90 focus:outline-none hover:scale-110 transition-all duration-300"
              style={{
                background: "radial-gradient(circle at 50% 50%, #041729 0%, #1A2C3E 100%)"
              }}
            >
              <span className="font-sans font-medium text-sm tracking-[0.0571em] uppercase">
                Begin Your Curatorship
              </span>
            </button>
          </form>

          {/* Horizontal Border & Footer Link */}
          <div className="border-t border-[#C4C6CD]/15 pt-8 w-full flex justify-center">
            <Link
              href="/login"
              className="font-sans font-medium text-sm text-[#5F5E5E] hover:text-[#041729] transition-colors"
            >
              Already have a key? Enter the sanctuary.
            </Link>
          </div>

        </div>
      </div>
    </main>
  );
}
