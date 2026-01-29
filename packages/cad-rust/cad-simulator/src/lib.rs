//! Physics-based assembly sequence simulator.
//!
//! Uses the "assembly-by-disassembly" algorithm:
//! 1. Load fully assembled model
//! 2. Find parts that can be removed (no blocking collisions)
//! 3. Test removal in 6 directions (+/- X, Y, Z)
//! 4. Build disassembly sequence
//! 5. Reverse for assembly sequence

pub mod collision;
pub mod sequence;
pub mod simulator;
pub mod stability;

pub use sequence::*;
pub use simulator::*;
