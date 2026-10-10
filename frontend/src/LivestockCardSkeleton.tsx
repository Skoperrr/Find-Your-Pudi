import { CardFrame } from "./LivestockCard";
const Bone = ({ className }: { className: string }) => (
  <div
    className={`rounded bg-[#DCE5D6] motion-safe:animate-pulse ${className}`}
  />
);
export default function LivestockCardSkeleton() {
  return (
    <div aria-hidden="true">
      <CardFrame image={<Bone className="h-full w-full rounded-none" />}>
        <div className="flex h-4 justify-between">
          <Bone className="h-3 w-20" />
          <Bone className="h-3 w-16" />
        </div>
        <div className="flex min-h-14 flex-col justify-center gap-2">
          <Bone className="h-5 w-4/5" />
          <Bone className="h-5 w-3/5" />
        </div>
        <Bone className="h-7 w-32" />
        <div className="flex min-h-6 items-center">
          <Bone className="h-4 w-3/4" />
        </div>
        <div className="flex min-h-11 items-center justify-between border-t border-[#D5D9CD] pt-3">
          <Bone className="h-3 w-24" />
          <Bone className="h-3 w-20" />
        </div>
      </CardFrame>
    </div>
  );
}
