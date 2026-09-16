import { MessagesView } from "./_components/messages-view";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-3xl tracking-tight">Activity</h2>
        <p className="text-muted-foreground">Live ingested messages. Full timeline lands with Goal 6.</p>
      </div>
      <MessagesView />
    </div>
  );
}
