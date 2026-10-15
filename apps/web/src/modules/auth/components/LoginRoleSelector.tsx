/** 渲染登录时可选择的系统角色单选组。 */
import { RoleIcon } from '@/components/icons';
import { SegmentedControl } from '@/components/ui/shared/SegmentedControl';
import { AUTH_ROLES } from '../types';

interface LoginRoleSelectorProps {
  role: string;
  onChange: (role: string) => void;
}

/** 展示登录身份选项，并向上层同步当前角色。 */
export default function LoginRoleSelector({ role, onChange }: LoginRoleSelectorProps) {
  return (
    <section aria-labelledby="login-role-label">
      <span id="login-role-label" className="mb-[10px] block text-[13px] font-[650] text-[#294554]">
        登录角色
        <span aria-hidden className="ml-[3px] text-destructive">
          *
        </span>
      </span>
      <SegmentedControl
        variant="bare"
        name="login-role"
        value={role}
        required
        ariaLabelledBy="login-role-label"
        className="grid w-full grid-cols-3 gap-[9px] max-[580px]:grid-cols-1"
        options={AUTH_ROLES.map((registrationRole) => {
          const label = registrationRole.label;
          return {
            value: label,
            label: (
              <>
                <i
                  className="m-0 flex h-[18px] w-[18px] flex-[0_0_18px] items-center justify-center text-[#527389] not-italic leading-none [&_svg]:block [&_svg]:h-full [&_svg]:w-full [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.7]"
                  aria-hidden="true"
                >
                  <RoleIcon role={registrationRole.value} />
                </i>
                <span className="block leading-[18px]">{label}</span>
              </>
            ),
          };
        })}
        optionClassName={({ selected }) =>
          `mr-[-1px] h-[39px] cursor-pointer gap-[6px] rounded-[11px] border p-0 text-[12px] leading-none font-normal transition-none ${selected ? 'border-[#0f9cb5] bg-[#eefbfc] text-[#143d4a] hover:bg-[#eefbfc]' : 'border-[#d8e2ec] bg-white text-[#51697a] hover:bg-white'}`
        }
        onValueChange={onChange}
      />
    </section>
  );
}
