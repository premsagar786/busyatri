import { Stack } from "expo-router";
import { useEffect } from "react";
import { initQueue } from "../src/queue/db";
import { watchNetwork } from "../src/network/status";

export default function Layout() {
  useEffect(() => {
    initQueue().catch((e) => console.error(e));
    const unsub = watchNetwork();
    return () => unsub();
  }, []);
  return <Stack screenOptions={{ headerShown: false }} />;
}
