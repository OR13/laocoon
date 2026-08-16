import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { PeopleIndex } from "@/components/people-index";
import { coverageLine, loadPublic } from "@/lib/data";

export default async function PeoplePage() {
  const { network, windows } = await loadPublic();
  return (
    <SiteShell
      title="People"
      lede="Everyone who has posted, with what they have published."
      active="/people/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      <PeopleIndex people={network?.nodes ?? []} />
    </SiteShell>
  );
}
