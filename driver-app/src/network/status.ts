import NetInfo from "@react-native-community/netinfo";
import { useTrip } from "../store/tripStore";
import { wakeSync } from "../queue/sync";

export function watchNetwork() {
  return NetInfo.addEventListener((state) => {
    const online = !!state.isConnected;
    useTrip.getState().set({ online });
    if (online) wakeSync();
  });
}
