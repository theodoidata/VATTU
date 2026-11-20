# Báo cáo nhập file Excel

File: **QUẢN LÝ KHO TỔNG.xlsx** (sheet đầu tiên)

- **811** vật tư, **29** nhóm.
- Số vật tư có tồn đầu kỳ: CN. HÙNG VƯƠNG: 34 · CN. TRẦN PHÚ: 6 · CN. CẨM PHẢ: 72 · CN. HẠ LONG: 78 · CN. QUẢNG YÊN: 38 · CN. UÔNG BÍ: 28 · CN. MẠO KHÊ: 36 · Kho tổng: 741 · CN. HÒA BÌNH: 39 · XƯỞNG RĂNG: 1
- Tồn **Kho tổng** lấy từ cột "Số lượng tồn kho".
- Tồn **chi nhánh** = "Số lượng nhận" − "Số lượng tiêu hao". Cột tiêu hao trong file đang trống, nên tồn chi nhánh đang bằng số đã nhận. Các chi nhánh cần **Kiểm kê** để chốt số thật.
- Chưa có số lô, hạn dùng, mức tối thiểu: bổ sung dần trong **Danh mục**.

## 1. Tồn kho tổng đang âm (24 dòng) — đã nhập là 0, cần kiểm tra lại
- DC-009 Kẹp gắp: tồn kho tổng = -7 (tổng 3)
- GU-011 Chỉ nilong 5/0: tồn kho tổng = -5 (tổng 0)
- DCU-001 DC niti 17x25 trên: tồn kho tổng = -12 (tổng 0)
- DCU-028 Dây cung Sialoy 16x22 dưới: tồn kho tổng = -13 (tổng 7)
- DCU-073 Dây CNA 0,16 x 22: tồn kho tổng = -2 (tổng 5)
- TMY-002 Trụ mỹ 5.0x10: tồn kho tổng = -6 (tổng 4)
- TBI-002 Trụ Bio 5.0x11.5: tồn kho tổng = -6 (tổng 4)
- TNE-014 Lá cắt kẽ: tồn kho tổng = -1 (tổng 0)
- TNE-015 chỉ B: tồn kho tổng = -1 (tổng 0)
- TNE-027 đầu trộn silicon lỏng to: tồn kho tổng = -50 (tổng 0)
- TNE-028 đầu trộn silicon lỏng nhỏ: tồn kho tổng = -100 (tổng 0)
- TH-009 Solu - Medol: tồn kho tổng = -1 (tổng 10)
- DCP-014 Thạch Cao vàng: tồn kho tổng = -6 (tổng 0)
- CH-019 Chun chuỗi mắt mau: tồn kho tổng = -2 (tổng 0)
- V4N-015 Com lỏng đen A2, A3: tồn kho tổng = -26 (tổng 0)
- V4N-022 Bond cam: tồn kho tổng = -1 (tổng 4)
- V4N-030 Mặt gương: tồn kho tổng = -8 (tổng 3)
- MU-010 Muti thường thẳng H3, H4: tồn kho tổng = -10 (tổng 0)
- MU-024 Multi nghiêng 17 cao 3: tồn kho tổng = -5 (tổng 15)
- MU-136 Thám châm: tồn kho tổng = -4 (tổng 16)
- MU-148 Khẩu trang: tồn kho tổng = -5 (tổng 3)
- MU-166 Cốc giấy: tồn kho tổng = -5 (tổng 57)
- MU-177 Mũi pro 2ef: tồn kho tổng = -5 (tổng 6)
- MU-192 Bơm 10 ml: tồn kho tổng = -1 (tổng 0)

## 2. Tên vật tư bị trùng (18 tên) — đang để thành các mã riêng, nên gộp hoặc đổi tên
- DC-009 (dòng 12), T2-038 (dòng 613), MU-135 (dòng 748) — Kẹp gắp
- FM-012 (dòng 29), FM-027 (dòng 44) — EX 12C
- FM-082 (dòng 99), FM-086 (dòng 103) — Mài xương zico trám nhỏ
- FM-083 (dòng 100), FM-087 (dòng 104) — Mài xương zico trám to
- FM-084 (dòng 101), FM-088 (dòng 105) — Mũi cắt xương tay chậm tròn to
- FM-085 (dòng 102), FM-089 (dòng 106) — Mũi cắt xương tay chậm tròn nhỏ
- AN-001 (dòng 281), MU-028 (dòng 641) — Analog Mini
- CN-004 (dòng 311), MU-108 (dòng 721) — Art Big
- HE-039 (dòng 357), MU-016 (dòng 629) — Con vặn tay
- TCO-001 (dòng 390), TCO-005 (dòng 394) — Trụ Core 4.0x11.5
- DCP-006 (dòng 478), MU-153 (dòng 766) — Sáp lá
- DCP-007 (dòng 479), MU-154 (dòng 767) — Sáp cây
- CH-021 (dòng 519), MU-070 (dòng 683) — Banh cao su
- CH-026 (dòng 524), CH-027 (dòng 525) — Chun đơn mắt lưỡi
- V4N-028 (dòng 561), V4N-029 (dòng 562), MU-202 (dòng 816) — Màng xương
- MU-056 (dòng 669), MU-072 (dòng 685) — Chỉ thép 0,2
- MU-076 (dòng 689), MU-098 (dòng 711) — Button kéo R ngầm
- MU-146 (dòng 759), MU-192 (dòng 805) — Bơm 10 ml

## 3. Chưa có đơn vị tính (335 vật tư) — tạm đặt "cái"
- FM-069 Bộ mũi chỉnh sứ
- FM-100 Keo tháo lắp
- V5D-004 Bond sứ
- FT-024 Thước đo nội nha
- TTR-001 tuýp che lợi
- TTR-002 Bột tẩy trắng
- TTR-003 Nước
- GU-004 H8- 21
- GU-005 H15-21
- GU-006 H15-25
- GU-007 HH20 - 25
- GU-008 Châm gai vàng
- GU-009 Mũi gate
- DCU-013 Niti 12 dưới
- DCU-014 Niti 12 trên
- DCU-015 Niti 18 dưới
- DCU-016 Niti 18 trên
- DCU-017 Niti 17x25 trên
- DCU-019 Niti 19 x 25 trên
- DCU-020 Niti 19 x 25 dưới
- DCU-021 Niti 14 x 25 R24
- DCU-022 Niti 14 x 25 R26
- DCU-023 Niti 14 x 25 R28
- DCU-024 Niti 18 x 25 R24
- DCU-025 Niti 18 x 25 R26
- DCU-026 Niti 18 x 25 R28
- DCU-027 Dây cung Sialoy 16x22 trên
- DCU-056 Nickel Titanium Ultra form Archwire 16 dưới
- DCU-058 Niti 14 dưới
- CO-001 Mini 4,5 x 15
- CO-002 Mini 4,5 x 11
- CO-003 Mini 4,0 x 11
- CO-004 Multi 4,8 x 12
- CO-005 Multi 4,8 x 10
- CO-006 Mini Vis 2,0 x 14
- CO-007 Mini Vis 2,0 x 12
- CO-008 Mini Vis 1,6 x 10
- CO-009 Mini Vis 1,6 x 8
- CO-010 Mini Vis 2,0 x 10
- CO-011 Mini Vis 1,6 x 6
- … và 295 vật tư khác (lọc trong Danh mục)

## 4. Ô số lượng ghi bằng chữ (7) — đã lưu vào ghi chú vật tư
- DCP-010 Chất lấy dấu (Aroma GC): "còn 18 sau khi xuất"
- V3N-007 Chỉ co nướu vàng 00: "sau xuất còn 2"
- V3N-008 Chỉ co nướu tím 0: "sau khi xuất còn 8"
- V3N-009 Chỉ co nướu xanh 000: "sau khi xuất 13"
- MU-038 MC R6 (1 ống) slot 0,22: "22 + 2 hộp"
- MU-039 MC R6 (1 ống slot 0,18: "18 + 10 hộp + 4 túi"
- MU-047 MC KL 0,18: "76 bộ + 125"
