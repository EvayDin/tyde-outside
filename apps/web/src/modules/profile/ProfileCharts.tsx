const DAY = 86_400_000;
const HEAT_COLORS = [
  'var(--color-surface-muted-hover)',
  'color-mix(in srgb, var(--primary) 20%, white)',
  'color-mix(in srgb, var(--primary) 42%, white)',
  'color-mix(in srgb, var(--primary) 70%, white)',
  'var(--color-primary-strong)',
];
const ABILITIES = [
  { name: '质量', score: 92, description: '交付质量与结果准确性' },
  { name: '效率', score: 86, description: '执行节奏与任务完成效率' },
  { name: '协作', score: 90, description: '沟通反馈与团队配合' },
  { name: '规范', score: 94, description: '流程遵循与操作规范' },
  { name: '学习', score: 82, description: '知识积累与新技能掌握' },
  { name: '稳定', score: 88, description: '持续投入与表现稳定性' },
];

function makeCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const today = Date.UTC(year, now.getMonth(), now.getDate());
  const firstDay = Date.UTC(year, 0, 1);
  const firstSunday = firstDay - new Date(firstDay).getUTCDay() * DAY;
  const lastDay = Date.UTC(year, 11, 31);
  const weekCount = Math.ceil((lastDay - firstSunday + DAY) / (7 * DAY));
  const weeks = Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const timestamp = firstSunday + (week * 7 + weekday) * DAY;
      const date = new Date(timestamp);
      const outsideYear = date.getUTCFullYear() !== year;
      const future = timestamp > today;
      const dayOfYear = Math.floor((timestamp - firstDay) / DAY);
      // 固定规则仅生成可复现的展示数据，不读取或推断当前用户的实际表现。
      const attended =
        !outsideYear && !future && weekday > 0 && weekday < 6 && dayOfYear % 13 !== 0;
      const value = outsideYear || future ? null : attended ? 1 + ((dayOfYear * 7) % 9) : 0;
      return {
        date: date.toISOString().slice(0, 10),
        outsideYear,
        future,
        attended,
        value,
      };
    }),
  );
  return { year, firstSunday, weeks };
}

function heatLevel(value: number) {
  return value === 0 ? 0 : Math.min(4, Math.ceil(value / 2.5));
}

function radarPoint(index: number, value: number): [number, number] {
  const angle = (index * Math.PI) / 3 - Math.PI / 2;
  const radius = (value / 100) * 88;
  return [150 + Math.cos(angle) * radius, 132 + Math.sin(angle) * radius];
}

function radarPolygon(value: number) {
  return ABILITIES.map((_, index) => radarPoint(index, value).join(',')).join(' ');
}

function ExampleLabel() {
  return (
    <span className="shrink-0 rounded-[4px] border bg-muted px-[6px] py-[2px] text-[11px] leading-[16px] font-normal text-[var(--color-neutral-strong)]">
      示例数据
    </span>
  );
}

/** 个人主页的展示图表；全部标记为示例，不代表用户的真实考勤或能力评估。 */
export function ProfileCharts() {
  const { year, firstSunday, weeks } = makeCalendar();
  const days = weeks.flat();
  const attendance = days.filter((day) => day.attended).length;
  const reports = days.reduce((total, day) => total + (day.value ?? 0), 0);
  const step = 13;
  const left = 28;
  const top = 26;
  const width = left + weeks.length * step;

  return (
    <div className="flex min-w-0 flex-col gap-[24px] text-[13px] leading-[20px]">
      <section
        aria-labelledby="profile-attendance-title"
        className="min-w-0 rounded-[8px] border bg-card p-[20px]"
      >
        <header className="flex flex-wrap items-start justify-between gap-[12px]">
          <div>
            <div className="flex flex-wrap items-center gap-[8px]">
              <h2
                id="profile-attendance-title"
                className="m-0 text-[16px] leading-[24px] font-semibold tracking-normal"
              >
                考勤与报量
              </h2>
              <ExampleLabel />
            </div>
            <p className="mt-[6px] text-[12px] text-[var(--color-neutral-strong)]">
              示例考勤 <span className="font-medium text-foreground">{attendance} 天</span>
              <span className="mx-[8px]" aria-hidden>
                ·
              </span>
              累计示例报量{' '}
              <span className="font-medium text-foreground">
                {reports.toLocaleString('zh-CN')} 次
              </span>
            </p>
          </div>
          <span className="rounded-[5px] border px-[8px] py-[3px] text-[12px] text-[var(--color-neutral-strong)]">
            {year} 年
          </span>
        </header>
        <div
          className="mt-[20px] max-w-full overflow-x-auto pb-[4px] outline-offset-[3px] focus-visible:outline-2 focus-visible:outline-ring"
          role="region"
          aria-label={`${year} 年每日示例报量图，可横向滚动查看全年`}
          tabIndex={0}
        >
          <svg
            viewBox={`0 0 ${width} 124`}
            className="block w-full min-w-[660px]"
            role="group"
            aria-labelledby="profile-heatmap-description"
          >
            <title id="profile-heatmap-description">
              {year} 年考勤与报量示例。颜色越深代表每日示例报量越多，未来日期不生成数据。
            </title>
            {Array.from({ length: 12 }, (_, month) => {
              const week = Math.floor((Date.UTC(year, month, 1) - firstSunday) / (7 * DAY));
              return (
                <text
                  key={month}
                  x={left + week * step}
                  y={12}
                  fill="var(--color-neutral-strong)"
                  fontSize={11}
                >
                  {month + 1}月
                </text>
              );
            })}
            {[1, 3, 5].map((weekday) => (
              <text
                key={weekday}
                x={0}
                y={top + weekday * step + 8}
                fill="var(--color-neutral-strong)"
                fontSize={10}
              >
                {['日', '一', '二', '三', '四', '五', '六'][weekday]}
              </text>
            ))}
            {weeks.map((week, column) =>
              week.map((day, row) => {
                if (day.outsideYear) return null;
                const label = day.future
                  ? `${day.date}，未来日期，暂无数据`
                  : `${day.date}，示例报量 ${day.value} 次，${day.attended ? '示例已考勤' : '示例未考勤'}`;
                return (
                  <rect
                    key={day.date}
                    x={left + column * step}
                    y={top + row * step}
                    width={10}
                    height={10}
                    rx={2}
                    fill={day.future ? 'var(--background)' : HEAT_COLORS[heatLevel(day.value ?? 0)]}
                    stroke="var(--border)"
                    strokeOpacity={day.future ? 0.7 : 0.35}
                    strokeDasharray={day.future ? '2 1' : undefined}
                    role="img"
                    aria-label={label}
                  >
                    <title>{label}</title>
                  </rect>
                );
              }),
            )}
          </svg>
        </div>
        <div className="mt-[12px] flex flex-wrap items-center justify-between gap-[8px] text-[11px] text-[var(--color-neutral-strong)]">
          <p>色深表示每日示例报量；虚线格为未来日期。</p>
          <div className="flex items-center gap-[4px]" aria-label="示例报量由少到多的五级色阶">
            <span className="mr-[2px]">少</span>
            {HEAT_COLORS.map((color, index) => (
              <span
                key={color}
                className="size-[10px] rounded-[2px] border border-border/40"
                style={{ background: color }}
                title={['0 次', '1～2 次', '3～5 次', '6～7 次', '8 次及以上'][index]}
                aria-hidden
              />
            ))}
            <span className="ml-[2px]">多</span>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="profile-ability-title"
        className="min-w-0 rounded-[8px] border bg-card p-[20px]"
      >
        <header>
          <div className="flex flex-wrap items-center gap-[8px]">
            <h2
              id="profile-ability-title"
              className="m-0 text-[16px] leading-[24px] font-semibold tracking-normal"
            >
              能力雷达
            </h2>
            <ExampleLabel />
          </div>
          <p className="mt-[6px] text-[12px] text-[var(--color-neutral-strong)]">
            六个维度展示能力分布，示例分数范围为 0–100。
          </p>
        </header>
        <div
          className="mt-[20px] grid min-w-0 items-center gap-[20px]"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}
        >
          <figure className="m-0 min-w-0">
            <svg
              viewBox="0 0 300 270"
              className="mx-auto block w-full max-w-[300px]"
              role="img"
              aria-labelledby="profile-radar-description"
            >
              <title id="profile-radar-description">
                能力雷达示例，满分 100：
                {ABILITIES.map((item) => `${item.name} ${item.score} 分`).join('，')}。
              </title>
              {[20, 40, 60, 80, 100].map((value) => (
                <polygon
                  key={value}
                  points={radarPolygon(value)}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={0.8}
                />
              ))}
              {ABILITIES.map((item, index) => {
                const [x, y] = radarPoint(index, 100);
                const [labelX, labelY] = radarPoint(index, 130);
                return (
                  <g key={item.name}>
                    <line
                      x1={150}
                      y1={132}
                      x2={x}
                      y2={y}
                      stroke="var(--border)"
                      strokeWidth={0.8}
                    />
                    <text
                      x={labelX}
                      y={labelY + 4}
                      fill="var(--color-neutral-strong)"
                      fontSize={12}
                      textAnchor="middle"
                    >
                      {item.name}
                    </text>
                  </g>
                );
              })}
              <polygon
                points={ABILITIES.map((item, index) =>
                  radarPoint(index, item.score).join(','),
                ).join(' ')}
                fill="var(--primary)"
                fillOpacity={0.16}
                stroke="var(--primary)"
                strokeWidth={2}
              />
              {ABILITIES.map((item, index) => {
                const [x, y] = radarPoint(index, item.score);
                return <circle key={item.name} cx={x} cy={y} r={3} fill="var(--primary)" />;
              })}
              {[0, 20, 40, 60, 80, 100].map((value) => (
                <text
                  key={value}
                  x={155}
                  y={132 - (value / 100) * 88 + 3}
                  fill="var(--color-neutral-strong)"
                  fontSize={9}
                >
                  {value}
                </text>
              ))}
            </svg>
            <figcaption className="flex items-center justify-center gap-[6px] text-[11px] text-[var(--color-neutral-strong)]">
              <span className="h-[3px] w-[14px] rounded-full bg-primary" aria-hidden />
              示例能力评分
            </figcaption>
          </figure>
          <dl className="m-0 grid min-w-0 gap-[12px]">
            {ABILITIES.map((item) => (
              <div key={item.name} className="min-w-0">
                <dt className="flex items-baseline justify-between gap-[12px] font-medium">
                  <span>{item.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {item.score}
                    <span className="ml-[4px] text-[11px] font-normal text-[var(--color-neutral-strong)]">
                      / 100
                    </span>
                  </span>
                </dt>
                <dd className="m-0 mt-[2px] text-[11px] leading-[16px] text-[var(--color-neutral-strong)]">
                  {item.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
