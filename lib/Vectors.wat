(module
  (memory (export "mem") 256)  ;; 16MB shared linear memory; JS writes into this

  ;;────────────────────────────────────────────────────────────────
  ;; PRIVATE: internal dot product kernel (used by dot_many & project)
  ;; q_ptr: float32[dim], m_ptr: float32[dim], dim: i32
  ;; Returns f32 result on stack
  ;;────────────────────────────────────────────────────────────────
  (func $dot_f32
    (param $q_ptr i32)(param $m_ptr i32)(param $dim i32)
    (result f32)
    (local $j i32)
    (local $j_simd_end i32)
    (local $acc v128)
    (local $sum f32)

    (local.set $j_simd_end (i32.and (local.get $dim) (i32.const 0xFFFFFFFC)))
    (local.set $acc (v128.const f32x4 0 0 0 0))

    (block $break_simd
      (loop $loop_simd
        (br_if $break_simd (i32.ge_u (local.get $j) (local.get $j_simd_end)))
        (local.set $acc
          (f32x4.add (local.get $acc)
            (f32x4.mul
              (v128.load (i32.add (local.get $q_ptr) (i32.shl (local.get $j) (i32.const 2))))
              (v128.load (i32.add (local.get $m_ptr) (i32.shl (local.get $j) (i32.const 2)))))))
        (local.set $j (i32.add (local.get $j) (i32.const 4)))
        (br $loop_simd)
      )
    )

    ;; Horizontal lane reduction
    (local.set $sum
      (f32.add
        (f32.add
          (f32x4.extract_lane 0 (local.get $acc))
          (f32x4.extract_lane 1 (local.get $acc)))
        (f32.add
          (f32x4.extract_lane 2 (local.get $acc))
          (f32x4.extract_lane 3 (local.get $acc)))))

    ;; Scalar tail (handles dim not divisible by 4)
    (block $break_tail
      (loop $loop_tail
        (br_if $break_tail (i32.ge_u (local.get $j) (local.get $dim)))
        (local.set $sum
          (f32.add (local.get $sum)
            (f32.mul
              (f32.load (i32.add (local.get $q_ptr) (i32.shl (local.get $j) (i32.const 2))))
              (f32.load (i32.add (local.get $m_ptr) (i32.shl (local.get $j) (i32.const 2)))))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $loop_tail)
      )
    )

    (local.get $sum)
  )

  ;;────────────────────────────────────────────────────────────────
  ;; dot_many
  ;; q_ptr:   float32[dim]           one query vector
  ;; m_ptr:   float32[dim * count]   row-major matrix of candidates
  ;; out_ptr: float32[count]         output cosine scores (if pre-normalized, dot == cosine)
  ;; dim, count: i32
  ;;────────────────────────────────────────────────────────────────
  (func (export "dot_many")
    (param $q_ptr i32)(param $m_ptr i32)(param $out_ptr i32)
    (param $dim i32)(param $count i32)
    (local $i i32)
    (local $row_ptr i32)
    (local $row_bytes i32)

    (local.set $row_bytes (i32.shl (local.get $dim) (i32.const 2)))

    (block $break_i
      (loop $loop_i
        (br_if $break_i (i32.ge_u (local.get $i) (local.get $count)))

        (local.set $row_ptr
          (i32.add (local.get $m_ptr)
                   (i32.mul (local.get $i) (local.get $row_bytes))))

        (f32.store
          (i32.add (local.get $out_ptr) (i32.shl (local.get $i) (i32.const 2)))
          (call $dot_f32 (local.get $q_ptr) (local.get $row_ptr) (local.get $dim)))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_i)
      )
    )
  )

  ;;────────────────────────────────────────────────────────────────
  ;; project
  ;; vec_ptr:  float32[dim_in]            full embedding
  ;; P_ptr:    float32[dim_out * dim_in]  projection matrix, row-major
  ;; out_ptr:  float32[dim_out]           projected result
  ;; dim_in, dim_out: i32   (e.g. 768→64 or 768→128 at runtime)
  ;; Structurally identical to dot_many; routing policy picks dim_out.
  ;;────────────────────────────────────────────────────────────────
  (func (export "project")
    (param $vec_ptr i32)(param $P_ptr i32)(param $out_ptr i32)
    (param $dim_in i32)(param $dim_out i32)
    (local $i i32)
    (local $row_ptr i32)
    (local $row_bytes i32)

    (local.set $row_bytes (i32.shl (local.get $dim_in) (i32.const 2)))

    (block $break_i
      (loop $loop_i
        (br_if $break_i (i32.ge_u (local.get $i) (local.get $dim_out)))

        (local.set $row_ptr
          (i32.add (local.get $P_ptr)
                   (i32.mul (local.get $i) (local.get $row_bytes))))

        (f32.store
          (i32.add (local.get $out_ptr) (i32.shl (local.get $i) (i32.const 2)))
          (call $dot_f32 (local.get $vec_ptr) (local.get $row_ptr) (local.get $dim_in)))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_i)
      )
    )
  )

  ;;────────────────────────────────────────────────────────────────
  ;; hash_binary
  ;; vec_ptr:  float32[dim_in]           L2-normalised embedding
  ;; P_ptr:    float32[bits * dim_in]    random hyperplane matrix
  ;; code_ptr: i32[ceil(bits/32)]        packed output bitcode (caller pre-zeroes)
  ;; dim_in, bits: i32
  ;;
  ;; For each hyperplane row b:  dot >= 0 → set bit b;  else leave 0.
  ;; words_per_code = ceil(bits/32).  Works for any bits at runtime.
  ;;────────────────────────────────────────────────────────────────
  (func (export "hash_binary")
    (param $vec_ptr i32)(param $P_ptr i32)(param $code_ptr i32)
    (param $dim_in i32)(param $bits i32)
    (local $b i32)
    (local $num_words i32)
    (local $w i32)
    (local $row_ptr i32)
    (local $row_bytes i32)
    (local $dot f32)
    (local $word_idx i32)
    (local $bit_pos i32)

    ;; Zero code words: num_words = ceil(bits/32) = (bits+31)>>5
    (local.set $num_words
      (i32.shr_u (i32.add (local.get $bits) (i32.const 31)) (i32.const 5)))
    (local.set $row_bytes (i32.shl (local.get $dim_in) (i32.const 2)))

    (block $break_zero
      (loop $loop_zero
        (br_if $break_zero (i32.ge_u (local.get $w) (local.get $num_words)))
        (i32.store
          (i32.add (local.get $code_ptr) (i32.shl (local.get $w) (i32.const 2)))
          (i32.const 0))
        (local.set $w (i32.add (local.get $w) (i32.const 1)))
        (br $loop_zero)
      )
    )

    (block $break_b
      (loop $loop_b
        (br_if $break_b (i32.ge_u (local.get $b) (local.get $bits)))

        (local.set $row_ptr
          (i32.add (local.get $P_ptr)
                   (i32.mul (local.get $b) (local.get $row_bytes))))

        (local.set $dot
          (call $dot_f32 (local.get $vec_ptr) (local.get $row_ptr) (local.get $dim_in)))

        ;; If dot >= 0, set bit b in the packed code
        (if (f32.ge (local.get $dot) (f32.const 0))
          (then
            (local.set $word_idx (i32.shr_u (local.get $b) (i32.const 5))) ;; b / 32
            (local.set $bit_pos  (i32.and   (local.get $b) (i32.const 31))) ;; b % 32
            (i32.store
              (i32.add (local.get $code_ptr) (i32.shl (local.get $word_idx) (i32.const 2)))
              (i32.or
                (i32.load
                  (i32.add (local.get $code_ptr) (i32.shl (local.get $word_idx) (i32.const 2))))
                (i32.shl (i32.const 1) (local.get $bit_pos))))))

        (local.set $b (i32.add (local.get $b) (i32.const 1)))
        (br $loop_b)
      )
    )
  )

  ;;────────────────────────────────────────────────────────────────
  ;; hamming_scores
  ;; q_code_ptr:    i32[words_per_code]
  ;; codes_ptr:     i32[words_per_code * count]   packed binary codes
  ;; out_ptr:       i32[count]                    output Hamming distances
  ;; words_per_code: ceil(bits/32), e.g. 2 for 64-bit, 4 for 128-bit
  ;; count:          number of items
  ;;────────────────────────────────────────────────────────────────
  (func (export "hamming_scores")
    (param $q_code_ptr i32)(param $codes_ptr i32)(param $out_ptr i32)
    (param $words_per_code i32)(param $count i32)
    (local $i i32)
    (local $w i32)
    (local $row_ptr i32)
    (local $dist i32)
    (local $row_stride i32)

    (local.set $row_stride (i32.shl (local.get $words_per_code) (i32.const 2)))

    (block $break_i
      (loop $loop_i
        (br_if $break_i (i32.ge_u (local.get $i) (local.get $count)))
        (local.set $dist (i32.const 0))
        (local.set $w (i32.const 0))
        (local.set $row_ptr
          (i32.add (local.get $codes_ptr)
                   (i32.mul (local.get $i) (local.get $row_stride))))

        (block $break_w
          (loop $loop_w
            (br_if $break_w (i32.ge_u (local.get $w) (local.get $words_per_code)))
            (local.set $dist
              (i32.add (local.get $dist)
                (i32.popcnt
                  (i32.xor
                    (i32.load (i32.add (local.get $q_code_ptr) (i32.shl (local.get $w) (i32.const 2))))
                    (i32.load (i32.add (local.get $row_ptr)    (i32.shl (local.get $w) (i32.const 2))))))))
            (local.set $w (i32.add (local.get $w) (i32.const 1)))
            (br $loop_w)
          )
        )

        (i32.store
          (i32.add (local.get $out_ptr) (i32.shl (local.get $i) (i32.const 2)))
          (local.get $dist))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_i)
      )
    )
  )

  ;;────────────────────────────────────────────────────────────────
  ;; topk_f32  — top-k by highest float score
  ;; scores_ptr: float32[count]  (mutated in-place: chosen slots → -inf)
  ;; out_ptr:    i32[k]          indices of top-k in descending order
  ;;────────────────────────────────────────────────────────────────
  (func (export "topk_f32")
    (param $scores_ptr i32)(param $out_ptr i32)
    (param $count i32)(param $k i32)
    (local $p i32)
    (local $i i32)
    (local $best_idx i32)
    (local $best_val f32)
    (local $cur_val f32)

    (block $break_p
      (loop $loop_p
        (br_if $break_p (i32.ge_u (local.get $p) (local.get $k)))
        (local.set $best_val (f32.const -inf))
        (local.set $i (i32.const 0))

        (block $break_scan
          (loop $loop_scan
            (br_if $break_scan (i32.ge_u (local.get $i) (local.get $count)))
            (local.set $cur_val
              (f32.load (i32.add (local.get $scores_ptr) (i32.shl (local.get $i) (i32.const 2)))))
            (if (f32.gt (local.get $cur_val) (local.get $best_val))
              (then
                (local.set $best_val (local.get $cur_val))
                (local.set $best_idx (local.get $i))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop_scan)
          )
        )

        (i32.store
          (i32.add (local.get $out_ptr) (i32.shl (local.get $p) (i32.const 2)))
          (local.get $best_idx))
        (f32.store
          (i32.add (local.get $scores_ptr) (i32.shl (local.get $best_idx) (i32.const 2)))
          (f32.const -inf))

        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $loop_p)
      )
    )
  )

  ;;────────────────────────────────────────────────────────────────
  ;; topk_i32  — top-k by lowest Hamming distance (closer = lower)
  ;; scores_ptr: i32[count]  (mutated in-place: chosen slots → 0x7FFFFFFF)
  ;; out_ptr:    i32[k]
  ;;────────────────────────────────────────────────────────────────
  (func (export "topk_i32")
    (param $scores_ptr i32)(param $out_ptr i32)
    (param $count i32)(param $k i32)
    (local $p i32)
    (local $i i32)
    (local $best_idx i32)
    (local $best_val i32)
    (local $cur_val i32)

    (block $break_p
      (loop $loop_p
        (br_if $break_p (i32.ge_u (local.get $p) (local.get $k)))
        (local.set $best_val (i32.const 0x7FFFFFFF))
        (local.set $i (i32.const 0))

        (block $break_scan
          (loop $loop_scan
            (br_if $break_scan (i32.ge_u (local.get $i) (local.get $count)))
            (local.set $cur_val
              (i32.load (i32.add (local.get $scores_ptr) (i32.shl (local.get $i) (i32.const 2)))))
            (if (i32.lt_s (local.get $cur_val) (local.get $best_val))
              (then
                (local.set $best_val (local.get $cur_val))
                (local.set $best_idx (local.get $i))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop_scan)
          )
        )

        (i32.store
          (i32.add (local.get $out_ptr) (i32.shl (local.get $p) (i32.const 2)))
          (local.get $best_idx))
        (i32.store
          (i32.add (local.get $scores_ptr) (i32.shl (local.get $best_idx) (i32.const 2)))
          (i32.const 0x7FFFFFFF))

        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $loop_p)
      )
    )
  )
)
