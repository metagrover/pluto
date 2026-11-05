import { lazy } from 'react';

// Secondary tabs load as separate chunks so startup parses only the shell,
// the dashboard and the recording views. preloadLazyViews warms them once the
// app is idle, so switching tabs does not wait on a chunk.
const loaders = {
  notes: () => import('./components/features/notes/NotesView'),
  tasks: () => import('./components/features/TasksView'),
  people: () => import('./components/KnowledgeGraph/PeopleTab'),
  projects: () => import('./components/KnowledgeGraph/ProjectsExecutionTab'),
  meetings: () => import('./components/features/AllMeetingsTab'),
  sources: () => import('./components/features/LocalSourcesTab'),
  askPluto: () => import('./components/features/AskPluto'),
  settings: () => import('./components/features/SettingsTab'),
};

export const NotesView = lazy(() =>
  loaders.notes().then((m) => ({ default: m.NotesView })),
);
export const TasksView = lazy(() =>
  loaders.tasks().then((m) => ({ default: m.TasksView })),
);
export const PeopleTab = lazy(() =>
  loaders.people().then((m) => ({ default: m.PeopleTab })),
);
export const ProjectsExecutionTab = lazy(() =>
  loaders.projects().then((m) => ({ default: m.ProjectsExecutionTab })),
);
export const AllMeetingsTab = lazy(() =>
  loaders.meetings().then((m) => ({ default: m.AllMeetingsTab })),
);
export const LocalSourcesTab = lazy(() =>
  loaders.sources().then((m) => ({ default: m.LocalSourcesTab })),
);
export const AskPluto = lazy(() =>
  loaders.askPluto().then((m) => ({ default: m.AskPluto })),
);
export const SettingsTab = lazy(() =>
  loaders.settings().then((m) => ({ default: m.SettingsTab })),
);

export const preloadLazyViews = () =>
  Promise.allSettled(Object.values(loaders).map((load) => load()));
