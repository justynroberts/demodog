// MIT License - Copyright (c) fintonlabs.com
import Foundation

/// Signal sources have to outlive the scope that creates them or GCD tears them
/// down immediately and the process dies on SIGINT without finalising the movie.
var signalSources: [DispatchSourceSignal] = []

/// Same reasoning for the one-shot command watchdogs.
var signalWatchdogs: [DispatchSourceTimer] = []
