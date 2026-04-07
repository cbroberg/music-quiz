import SwiftUI

/// DJ Mode display — shown between rounds. Renders the shared queue with the
/// current song spotlighted and per-player pick credits underneath. Driven
/// by `dj_state` broadcasts from the server (see `dj-mode.ts` `QueuedSong`).
struct DJModeView: View {
    @ObservedObject var coordinator: QuizCoordinator

    var body: some View {
        VStack(spacing: 32) {
            header
            HStack(alignment: .top, spacing: 56) {
                queueColumn
                picksColumn
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.horizontal, 80)
        .padding(.top, 60)
        .padding(.bottom, 40)
    }

    // ── Header ────────────────────────────────────────────
    private var header: some View {
        HStack {
            Text("DJ MODE")
                .font(Theme.display(28, weight: .heavy))
                .tracking(2)
                .foregroundColor(Theme.red)
            Spacer()
            if coordinator.djAutoplay {
                Label("Autoplay", systemImage: "infinity")
                    .font(Theme.display(20, weight: .semibold))
                    .foregroundColor(Theme.green)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Capsule().fill(Theme.green.opacity(0.15)))
            }
            if coordinator.roundNumber > 0 {
                Text("ROUND \(coordinator.roundNumber)")
                    .font(Theme.display(20, weight: .heavy))
                    .tracking(1)
                    .foregroundColor(Theme.red)
                    .padding(.horizontal, 16).padding(.vertical, 6)
                    .background(Capsule().fill(Theme.red.opacity(0.15)))
            }
        }
    }

    // ── Left: queue ───────────────────────────────────────
    private var queueColumn: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Queue")
                .font(Theme.display(32, weight: .heavy))
                .foregroundColor(Theme.text)

            if let current = coordinator.djCurrent {
                currentSongCard(current)
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    let upcoming = coordinator.djQueue.filter { !($0["played"] as? Bool ?? false) }
                    if upcoming.isEmpty {
                        Text("Queue is empty — players, pick a song on your phone")
                            .font(Theme.display(20, weight: .regular))
                            .italic()
                            .foregroundColor(Theme.dimmer)
                            .padding(.top, 16)
                    } else {
                        ForEach(0..<upcoming.count, id: \.self) { idx in
                            queueRow(upcoming[idx], position: idx + 1)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func currentSongCard(_ song: [String: Any]) -> some View {
        let name    = (song["name"] as? String) ?? "—"
        let artist  = (song["artistName"] as? String) ?? ""
        let added   = (song["addedBy"] as? String) ?? ""
        let avatar  = (song["addedByAvatar"] as? String) ?? "🎵"
        let artwork = (song["artworkUrl"] as? String).flatMap { URL(string: $0
            .replacingOccurrences(of: "{w}", with: "400")
            .replacingOccurrences(of: "{h}", with: "400")) }

        return HStack(spacing: 20) {
            artworkBox(url: artwork, size: 96)
            VStack(alignment: .leading, spacing: 4) {
                Text("NOW PLAYING")
                    .font(Theme.display(14, weight: .heavy))
                    .tracking(1.2)
                    .foregroundColor(Theme.green)
                Text(name)
                    .font(Theme.display(26, weight: .heavy))
                    .foregroundColor(Theme.text)
                    .lineLimit(1)
                Text(artist)
                    .font(Theme.display(20, weight: .medium))
                    .foregroundColor(Theme.muted)
                    .lineLimit(1)
                if !added.isEmpty {
                    Text("\(avatar) Picked by \(added)")
                        .font(Theme.display(16, weight: .regular))
                        .foregroundColor(Theme.dimmer)
                }
            }
            Spacer()
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 18).fill(Theme.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18).stroke(Theme.green.opacity(0.4), lineWidth: 2)
        )
    }

    private func queueRow(_ song: [String: Any], position: Int) -> some View {
        let name    = (song["name"] as? String) ?? "—"
        let artist  = (song["artistName"] as? String) ?? ""
        let avatar  = (song["addedByAvatar"] as? String) ?? "🎵"
        let added   = (song["addedBy"] as? String) ?? ""
        let artwork = (song["artworkUrl"] as? String).flatMap { URL(string: $0
            .replacingOccurrences(of: "{w}", with: "200")
            .replacingOccurrences(of: "{h}", with: "200")) }

        return HStack(spacing: 16) {
            Text("\(position)")
                .font(Theme.display(20, weight: .heavy))
                .foregroundColor(Theme.dimmer)
                .frame(width: 32)
            artworkBox(url: artwork, size: 56)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(Theme.display(20, weight: .semibold))
                    .foregroundColor(Theme.text)
                    .lineLimit(1)
                Text(artist)
                    .font(Theme.display(16, weight: .regular))
                    .foregroundColor(Theme.muted)
                    .lineLimit(1)
            }
            Spacer()
            Text("\(avatar) \(added)")
                .font(Theme.display(15, weight: .medium))
                .foregroundColor(Theme.dimmer)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
    }

    // ── Right: picks per player ───────────────────────────
    private var picksColumn: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Picks")
                .font(Theme.display(32, weight: .heavy))
                .foregroundColor(Theme.text)

            if coordinator.djPicks.isEmpty {
                Text("No picks yet")
                    .font(Theme.display(20, weight: .regular))
                    .italic()
                    .foregroundColor(Theme.dimmer)
            } else {
                ForEach(0..<coordinator.djPicks.count, id: \.self) { idx in
                    picksRow(coordinator.djPicks[idx])
                }
            }
            Spacer()
        }
        .frame(width: 360, alignment: .leading)
    }

    private func picksRow(_ entry: [String: Any]) -> some View {
        let name      = (entry["name"] as? String) ?? "—"
        let avatar    = (entry["avatar"] as? String) ?? "🎵"
        let available = (entry["availableCredits"] as? Int) ?? 0
        let queued    = (entry["queuedSongs"] as? Int) ?? 0

        return HStack(spacing: 14) {
            Text(avatar).font(.system(size: 30))
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(Theme.display(20, weight: .semibold))
                    .foregroundColor(Theme.text)
                Text("\(queued) queued")
                    .font(Theme.display(14, weight: .regular))
                    .foregroundColor(Theme.dimmer)
            }
            Spacer()
            Text("\(available)")
                .font(Theme.display(28, weight: .heavy))
                .foregroundColor(available > 0 ? Theme.red : Theme.dimmer)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
    }

    // ── Helpers ───────────────────────────────────────────
    private func artworkBox(url: URL?, size: CGFloat) -> some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase {
                        img.resizable().scaledToFill()
                    } else {
                        Theme.bg
                    }
                }
            } else {
                Theme.bg
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.18))
    }
}
