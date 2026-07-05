"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useRef, KeyboardEvent, ClipboardEvent, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signUpValidation } from "../lib/users/actions";

function VerifyOtpContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, value: string) => {
    if (!/^[0-9]*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").slice(0, 6).split("");
    if (!pastedData.some((char) => !/^[0-9]*$/.test(char))) {
      const newOtp = [...otp];
      pastedData.forEach((char, index) => {
        if (index < 6) newOtp[index] = char;
      });
      setOtp(newOtp);
      const focusIndex = Math.min(pastedData.length, 5);
      inputRefs.current[focusIndex]?.focus();
    }
  };

  return (
    <main className="min-h-screen relative flex flex-col items-center justify-center bg-[#FDF9EF] overflow-hidden px-6 py-20">
      {/* Background Layers */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/verify-bg1.png"
          alt="Scholarly Ink Sketches Overlay"
          fill
          className="object-cover opacity-15"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#FDF9EF] via-[#FDF9EF]/90 to-[#F7F3E9]" />
        <Image
          src="/verify-bg2.png"
          alt="Blurred Library Stacks"
          fill
          className="object-cover opacity-20 blur-[40px]"
          priority
        />
      </div>

      {/* Reading Progress Rail Aesthetic */}
      <div className="absolute left-8 top-1/2 -translate-y-1/2 w-[1px] h-[75vh] bg-[#D2E4FC] opacity-40 z-0 hidden md:block" />

      {/* Header - Top Branding Anchor */}
      <div className="absolute top-0 w-full flex justify-center py-12 z-10">
        <h1 className="font-liberation text-2xl text-[#041729] italic tracking-[-0.025em]">
          The Private Library
        </h1>
      </div>

      {/* Main Verification Canvas */}
      <div className="relative z-10 w-full max-w-[672px] flex flex-col items-stretch gap-12 mt-12 md:mt-0">
        <div className="bg-[#F7F3E9] border border-[#C4C6CD]/10 shadow-[0_12px_32px_0_rgba(28,28,22,0.06)] backdrop-blur-[12px] rounded p-8 md:p-12 w-full relative overflow-hidden">

          {/* Asymmetric decorative element */}
          <div className="absolute -right-[47px] -top-[47px] w-[192px] h-[192px] bg-[#D2E4FC]/20 blur-[64px] rounded-xl pointer-events-none" />

          {/* Subtle Texture Overlays */}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-[622px] max-w-[95%] h-1 bg-gradient-to-r from-[#B6C8E0]/0 via-[#B6C8E0]/20 to-[#B6C8E0]/0 pointer-events-none" />

          <div className="flex flex-col items-center gap-8 relative z-10">
            {/* Header */}
            <div className="flex flex-col items-center gap-4 text-center">
              <h2 className="font-noto font-bold text-3xl md:text-4xl text-[#041729] leading-tight md:leading-[45px] tracking-[-0.025em]">
                Verify Your Curatorship
              </h2>
              <div className="max-w-[448px]">
                <p className="font-sans text-base md:text-lg text-[#5F5E5E] leading-relaxed md:leading-[29.25px]">
                  An ink-signed code has been sent to your email.<br />
                  Please enter the six-digit sequence to proceed.
                </p>
              </div>
            </div>

            {/* OTP Input Form */}
            <form action={signUpValidation} className="flex flex-col items-center gap-12 w-full">
              <input type="hidden" name="email" value={email} />
              <div className="flex justify-center w-full max-w-[512px] gap-2 md:gap-4">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={otp[index]}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={handlePaste}
                    className="w-10 h-14 md:w-16 md:h-20 bg-[#ECE8DE] rounded text-center text-xl md:text-2xl font-sans text-[#041729] outline-none focus:shadow-[0_0_0_1px_#B6C8E0] transition-shadow"
                  />
                ))}
              </div>
              <input type="hidden" name="otp" value={otp.join("")} />

              <div className="flex flex-col items-center gap-8">
                <button
                  type="submit"
                  className="flex items-center justify-center w-[320px] max-w-full px-8 rounded py-4 bg-[#041729] shadow-[0_12px_32px_0_rgba(28,28,22,0.06)] text-[#FFFFFF] font-sans font-semibold text-sm tracking-[0.1em] uppercase hover:opacity-90 transition-opacity"
                >
                  Enter the Sanctuary
                </button>

                <div className="flex items-center gap-6">
                  <button type="button" className="font-sans text-xs text-[#5F5E5E] tracking-[0.1em] pb-1 border-b border-transparent hover:border-[#5F5E5E] transition-all">
                    Resend Code
                  </button>
                  <div className="w-1 h-1 rounded-full bg-[#C4C6CD]" />
                  <button type="button" className="font-sans text-xs text-[#5F5E5E] tracking-[0.1em] pb-1 border-b border-transparent hover:border-[#5F5E5E] transition-all">
                    Forgotten Ink?
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Footer - Editorial Footnote */}
        <div className="text-center px-4">
          <p className="font-sans text-[10px] text-[#74777D] tracking-[0.2em] leading-[16.25px] uppercase">
            Access is strictly curated. Your digital presence is encrypted<br className="hidden md:block" />
            <span className="md:hidden"> </span>with scholarly rigor and editorial precision.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VerifyOtpContent />
    </Suspense>
  );
}
