import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#FDF9EF] px-4 py-20 relative overflow-hidden">
      
      <div className="relative z-10 max-w-lg w-full flex flex-col items-center text-center gap-8">
        <h1 className="font-noto text-[120px] leading-none text-[#041729] tracking-[-0.05em] opacity-10 select-none">
          404
        </h1>
        
        <div className="flex flex-col gap-4 -mt-16 relative z-10">
          <h2 className="font-noto text-3xl text-[#041729] tracking-[-0.025em]">
            This page is lost to history.
          </h2>
          <p className="font-sans text-base text-[#5F5E5E] leading-relaxed max-w-md mx-auto">
            The manuscript you are looking for has either been moved to the restricted archives or does not exist in our collection.
          </p>
        </div>

        <Link 
          href="/"
          className="mt-6 flex items-center justify-center rounded-sm py-4 px-8 text-[#FFFFFF] shadow-[0px_12px_32px_0px_rgba(28,28,22,0.06)] hover:opacity-90 hover:scale-105 transition-all duration-300 focus:outline-none"
          style={{
            background: "radial-gradient(circle at 50% 50%, #041729 0%, #1A2C3E 100%)"
          }}
        >
          <span className="font-sans font-medium text-sm tracking-[0.0571em] uppercase">
            Return to the Library
          </span>
        </Link>
      </div>

      {/* Decorative element */}
      <div className="absolute bottom-16 opacity-30 flex flex-col items-center gap-4">
        <div className="w-12 h-[1px] bg-[#041729]" />
      </div>
    </main>
  );
}
