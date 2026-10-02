import { PlatformShell } from '@ligimed/ui';
export default function TransportHome() {
  return (
    <PlatformShell
      applicationName="Transport workspace"
      description="The transport application shell is isolated from pharmacy and dealer data unless a backend policy explicitly grants shipment access."
    />
  );
}
