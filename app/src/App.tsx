import { Booth } from './booth/Booth';
import { RipPlaceholder } from './rip/RipPlaceholder';
import { SettingsTab } from './settings/SettingsTab';
import { Tabs } from './shell/Tabs';

export function App() {
  return (
    <Tabs
      initial="booth"
      tabs={[
        { id: 'booth', label: 'Booth', view: () => <Booth /> },
        { id: 'rip', label: 'Rip', view: () => <RipPlaceholder /> },
        { id: 'settings', label: 'Settings', view: () => <SettingsTab /> },
      ]}
    />
  );
}
