import type { ReactNode } from 'react';

type EmptyArtwork =
  | 'recording'
  | 'notes'
  | 'tasks'
  | 'people'
  | 'projects'
  | 'chat';

const artwork: Record<EmptyArtwork, ReactNode> = {
  recording: (
    <>
      <rect x="22" y="27" width="236" height="130" rx="15" fill="#3d252d" />
      <path d="M22 57h236M22 128h236" stroke="#79545c" />
      <circle cx="43" cy="42" r="4" fill="#ffaf98" />
      <path
        d="M54 42h25m143 0h15M43 142h27m143 0h24"
        stroke="#bc9297"
        strokeLinecap="round"
      />
      <path d="M43 93h194" stroke="#79545c" />
      <path
        d="M49 89v8m11-12v16m11-21v26m11-17v8m11-29v50m11-38v26m11-45v64m11-50v36m11-26v16m11-29v42m11-51v60m11-37v14m11-20v26m11-39v52m11-38v24m11-19v14m11-12v10m11-8v6"
        stroke="#ffaf98"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </>
  ),
  notes: (
    <>
      <path
        d="M76 31h119l22 22v116H76z"
        fill="#cfac67"
        transform="rotate(8 146 100)"
      />
      <path d="M65 15h119l22 22v121H65z" fill="#fff1c9" />
      <path d="M184 15v22h22" fill="#e6c987" />
      <path
        d="M82 40h56M82 67h106M82 87h106M82 107h106M82 127h106"
        stroke="#a98a51"
      />
      <path
        d="M83 67v16"
        stroke="#9c4439"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="202" cy="151" r="21" fill="#9c4439" />
      <path
        d="M195 151h14m-7-7v14"
        stroke="#fff1c9"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  ),
  tasks: (
    <>
      <rect
        x="53"
        y="34"
        width="175"
        height="118"
        rx="13"
        fill="#556341"
        transform="rotate(-8 140 93)"
      />
      <rect x="45" y="34" width="182" height="116" rx="13" fill="#e0e9c8" />
      <path d="M65 74h142m-142 31h142" stroke="#a7b48e" />
      <rect x="66" y="48" width="13" height="13" rx="3" fill="#4e663a" />
      <path d="m69 54 2 2 5-5" stroke="#f0f3de" strokeWidth="1.5" fill="none" />
      <path
        d="M92 55h82m-82 34h105m-105 32h66"
        stroke="#70815e"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect
        x="66"
        y="83"
        width="13"
        height="13"
        rx="3"
        fill="none"
        stroke="#70815e"
      />
      <rect
        x="66"
        y="115"
        width="13"
        height="13"
        rx="3"
        fill="none"
        stroke="#70815e"
      />
    </>
  ),
  people: (
    <>
      <path
        d="M35 31h119a15 15 0 0 1 15 15v50a15 15 0 0 1-15 15H65l-30 19v-19a15 15 0 0 1-15-15V46a15 15 0 0 1 15-15Z"
        fill="#694566"
      />
      <path
        d="M125 71h119a15 15 0 0 1 15 15v50a15 15 0 0 1-15 15h-6v19l-29-19h-84a15 15 0 0 1-15-15V86a15 15 0 0 1 15-15Z"
        fill="#eacbe0"
      />
      <path
        d="M42 56h82M42 71h48"
        stroke="#eacbe0"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M133 98h100m-100 15h76m-76 15h45"
        stroke="#694566"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  projects: (
    <>
      <path
        d="M99 93h30m0 0V45h49m-49 48v46h49"
        stroke="#6b8d92"
        strokeWidth="2"
        fill="none"
      />
      <rect x="24" y="63" width="79" height="59" rx="10" fill="#245153" />
      <rect x="174" y="21" width="80" height="47" rx="9" fill="#b5dad1" />
      <rect x="174" y="116" width="80" height="47" rx="9" fill="#b5dad1" />
      <path
        d="M40 84h43M40 101h29"
        stroke="#b5dad1"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M189 39h48m-48 13h28m-28 82h48m-48 13h28"
        stroke="#245153"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="129" cy="93" r="5" fill="#b5dad1" stroke="#245153" />
    </>
  ),
  chat: (
    <>
      <path
        d="M33 125c47 0 43-69 91-69s44 69 91 69"
        fill="none"
        stroke="#7f7699"
        strokeWidth="1.5"
        strokeDasharray="3 6"
      />
      <path
        d="M54 58h49a11 11 0 0 1 11 11v22a11 11 0 0 1-11 11H68l-14 12v-12a11 11 0 0 1-11-11V69a11 11 0 0 1 11-11Z"
        fill="#594974"
      />
      <path
        d="M150 43h71a13 13 0 0 1 13 13v28a13 13 0 0 1-13 13v16l-21-16h-50a13 13 0 0 1-13-13V56a13 13 0 0 1 13-13Z"
        fill="#dfd6f5"
      />
      <path
        d="M155 64h59m-59 13h38"
        stroke="#594974"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="64" cy="80" r="2" fill="#dfd6f5" />
      <circle cx="78" cy="80" r="2" fill="#dfd6f5" />
      <circle cx="92" cy="80" r="2" fill="#dfd6f5" />
    </>
  ),
};

export function EmptyCanvasArt({ kind }: { kind: EmptyArtwork }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="empty-canvas-art"
      viewBox="0 0 280 184"
    >
      {artwork[kind]}
    </svg>
  );
}

export function EmptyCanvas({
  kind,
  title,
  description,
  children,
  compact = false,
}: {
  kind: Exclude<EmptyArtwork, 'chat'>;
  title: string;
  description: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="empty-canvas" data-kind={kind} data-compact={compact}>
      <div className="empty-canvas-layout">
        <div className="min-w-0">
          <h2 className="empty-canvas-title">{title}</h2>
          <p className="empty-canvas-copy">{description}</p>
          {children}
        </div>
        <EmptyCanvasArt kind={kind} />
      </div>
    </div>
  );
}
