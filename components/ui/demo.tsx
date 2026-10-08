"use client"

import ContributionSkyline from "./contribution-skyline"

export default function Demo() {
  return (
    <div className="w-full bg-background px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-[980px]">
        <ContributionSkyline />
      </div>
    </div>
  )
}
