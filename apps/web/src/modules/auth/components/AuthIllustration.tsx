/** 绘制认证页左侧不参与交互的品牌装饰插图。 */
import { TideIcon } from '@/components/icons';

/** 渲染认证页左侧的品牌说明与装饰插画。 */
export default function AuthIllustration() {
  return (
    <div className="relative mx-auto h-[215px] w-[250px] rotate-[-6deg]" aria-hidden="true">
      <div className="absolute top-[48px] right-[17px] h-[150px] w-[145px] rotate-[18deg] rounded-[29px] bg-[#b5e2e9]" />
      <div className="absolute bottom-[5px] left-[15px] z-[3] h-[50px] w-[50px] rotate-[20deg] rounded-[17px] bg-[#ead8e0]" />
      <div className="absolute top-[15px] left-[37px] z-[2] h-[195px] w-[180px] rounded-[25px] bg-white px-[29px] py-[49px] shadow-[0_14px_20px_rgba(36,67,74,0.14)]">
        {[0, 1, 2, 3].map((item) => (
          <div className="mb-[16px] flex items-center gap-[10px]" key={item}>
            <span className="grid h-[16px] w-[16px] place-items-center rounded-full border-[3px] border-[#29a9be] text-[12px] font-black text-[#29a9be]">
              ✓
            </span>
            <i
              className={`h-[8px] rounded-[8px] bg-[#e1e7f0] ${['w-[75px]', 'w-[68px]', 'w-[60px]', 'w-[50px]'][item]}`}
            />
          </div>
        ))}
      </div>
      <div className="absolute top-[-5px] right-[12px] z-[4] grid h-[38px] w-[38px] place-items-center rounded-[12px] bg-white text-[#1aa2b8] shadow-[0_8px_14px_rgba(42,79,87,0.12)]">
        <TideIcon className="h-[23px] w-[23px] fill-none stroke-current [stroke-linecap:round] [stroke-width:2]" />
      </div>
    </div>
  );
}
