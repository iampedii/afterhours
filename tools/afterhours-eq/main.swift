// afterhours-eq: listens to what this Mac is playing and writes, about 20 times a second, the level of
// 32 frequency bands for the left channel, 32 for the right, and the overall loudness, to a small
// text file that the Afterhours tab bar in Herdr reads.
// It never records or stores audio: each buffer is analysed and dropped.
//
// Output: /tmp/afterhours-eq.levels, one line of 65 integers 0..100: left bands (bass first), right
// bands, then loudness.
// Needs "Screen & System Audio Recording" permission (asked once). Quits when Herdr is gone.

import Accelerate
import AVFoundation
import Foundation
import ScreenCaptureKit

let outPath = "/tmp/afterhours-eq.levels"
let lockPath = "/tmp/afterhours-eq.lock"
let bandCount = 32
let fftSize = 2048
let sampleRate: Float = 48_000

// One copy at a time.
let lockFD = open(lockPath, O_CREAT | O_RDWR, 0o644)
if lockFD < 0 || flock(lockFD, LOCK_EX | LOCK_NB) != 0 { exit(0) }

func write(_ levels: [Int]) {
    let text = levels.map(String.init).joined(separator: " ") + "\n"
    let tmp = outPath + ".tmp"
    guard FileManager.default.createFile(atPath: tmp, contents: text.data(using: .utf8)) else { return }
    rename(tmp, outPath)   // atomic: a reader never sees half a line
}

final class Analyser: NSObject, SCStreamOutput, SCStreamDelegate {
    private let log2n = vDSP_Length(11)
    private let setup: FFTSetup
    private var window = [Float](repeating: 0, count: fftSize)
    private var left = [Float](), right = [Float]()
    private var smooth = [Float](repeating: 0, count: bandCount * 2)
    private var peak: Float = -30          // running loudest band, dB: makes the shape volume-independent
    private var loud: Float = 0            // overall loudness 0..1, absolute: tells a chorus from a verse
    private var lastWrite = Date.distantPast
    private var silent = false
    private var edges = [Int]()

    override init() {
        setup = vDSP_create_fftsetup(11, FFTRadix(kFFTRadix2))!
        vDSP_hann_window(&window, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))
        // Log-spaced band edges, 45 Hz .. 15 kHz, as FFT bin indexes.
        let lo: Float = 45, hi: Float = 15_000
        for i in 0...bandCount {
            let f = lo * powf(hi / lo, Float(i) / Float(bandCount))
            edges.append(Int(f * Float(fftSize) / sampleRate))
        }
        super.init()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        try? buffer.withAudioBufferList { list, _ in
            guard let first = list.first, let base = first.mData else { return }
            let count = Int(first.mDataByteSize) / MemoryLayout<Float>.size
            let l = UnsafeBufferPointer(start: base.assumingMemoryBound(to: Float.self), count: count)
            left.append(contentsOf: l)
            if list.count > 1, let rightBase = list[1].mData {
                right.append(contentsOf: UnsafeBufferPointer(start: rightBase.assumingMemoryBound(to: Float.self), count: count))
            } else {
                right.append(contentsOf: l)                  // mono source: both sides the same
            }
        }
        while left.count >= fftSize && right.count >= fftSize {
            frame(Array(left[0..<fftSize]), Array(right[0..<fftSize]))
            left.removeFirst(fftSize / 2)
            right.removeFirst(fftSize / 2)
        }
    }

    // One channel's band levels in dB.
    private func spectrum(_ x: [Float]) -> [Float] {
        var w = [Float](repeating: 0, count: fftSize)
        vDSP_vmul(x, 1, window, 1, &w, 1, vDSP_Length(fftSize))
        var real = [Float](repeating: 0, count: fftSize / 2), imag = [Float](repeating: 0, count: fftSize / 2)
        var mags = [Float](repeating: 0, count: fftSize / 2)
        real.withUnsafeMutableBufferPointer { rp in
            imag.withUnsafeMutableBufferPointer { ip in
                var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                w.withUnsafeBufferPointer { wp in
                    wp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: fftSize / 2) {
                        vDSP_ctoz($0, 2, &split, 1, vDSP_Length(fftSize / 2))
                    }
                }
                vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvabs(&split, 1, &mags, 1, vDSP_Length(fftSize / 2))
            }
        }
        var db = [Float](repeating: -120, count: bandCount)
        for b in 0..<bandCount {
            let from = max(1, edges[b]), to = max(from + 1, edges[b + 1])
            var m: Float = 0
            for k in from..<min(to, fftSize / 2) { m = max(m, mags[k]) }
            // Tilt: music has less energy up high; lift it about 3 dB per octave so treble shows.
            let tilt = 3 * log2f(Float(b + 1) / 4 + 1)
            db[b] = 20 * log10f(max(m / Float(fftSize / 2), 1e-7)) + tilt
        }
        return db
    }

    private func frame(_ l: [Float], _ r: [Float]) {
        let db = spectrum(l) + spectrum(r)
        let loudest = db.max() ?? -120
        peak = max(loudest, peak - 0.15)                    // falls ~7 dB a second
        let quiet = loudest < -72
        // Absolute loudness from the waveform itself (RMS), -55 dB .. -8 dB -> 0 .. 1, eased.
        var rmsL: Float = 0, rmsR: Float = 0
        vDSP_rmsqv(l, 1, &rmsL, vDSP_Length(fftSize)); vDSP_rmsqv(r, 1, &rmsR, vDSP_Length(fftSize))
        let level = min(1, max(0, (20 * log10f(max((rmsL + rmsR) / 2, 1e-7)) + 55) / 47))
        loud = quiet ? loud * 0.8 : loud * 0.8 + level * 0.2
        var out = [Int](repeating: 0, count: bandCount * 2 + 1)
        for b in 0..<(bandCount * 2) {
            let target: Float = quiet ? 0 : min(1, max(0, (db[b] - (peak - 42)) / 42))
            smooth[b] = target > smooth[b] ? target : smooth[b] * 0.72 + target * 0.28   // fast up, soft down
            out[b] = Int((smooth[b] * 100).rounded())
        }
        let allZero = out.allSatisfy { $0 == 0 }
        out[bandCount * 2] = Int((loud * 100).rounded())
        let now = Date()
        if allZero && silent { return }                      // nothing to say: leave the file alone
        if now.timeIntervalSince(lastWrite) < 0.045 && !allZero { return }
        lastWrite = now
        silent = allZero
        if allZero { out[bandCount * 2] = 0 }
        write(out)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { exit(1) }   // restarted by the tab bar
}

let analyser = Analyser()
var stream: SCStream?

func start() async {
    while true {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first else { throw NSError(domain: "afterhours-eq", code: 1) }
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = Int(sampleRate)
            config.channelCount = 2
            config.width = 2; config.height = 2                            // we only want the sound
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            let s = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: config, delegate: analyser)
            try s.addStreamOutput(analyser, type: .audio, sampleHandlerQueue: DispatchQueue(label: "afterhours-eq.audio"))
            try await s.startCapture()
            stream = s
            try? "ok\n".write(toFile: "/tmp/afterhours-eq.status", atomically: true, encoding: .utf8)
            return
        } catch {
            // Usually: permission not granted yet. Say so and try again quietly.
            try? "needs-permission: \(error.localizedDescription)\n".write(toFile: "/tmp/afterhours-eq.status", atomically: true, encoding: .utf8)
            try? await Task.sleep(nanoseconds: 8_000_000_000)
        }
    }
}

// Quit when Herdr is no longer running.
Task.detached {
    while true {
        try? await Task.sleep(nanoseconds: 6_000_000_000)
        let alive = NSWorkspace.shared.runningApplications.contains { $0.localizedName == "Herdr" || $0.executableURL?.lastPathComponent == "Herdr" }
        if !alive { write([Int](repeating: 0, count: bandCount * 2 + 1)); exit(0) }
    }
}

write([Int](repeating: 0, count: bandCount * 2 + 1))
Task { await start() }
RunLoop.main.run()
