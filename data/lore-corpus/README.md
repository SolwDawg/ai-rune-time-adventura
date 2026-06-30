# Danh mục định danh corpus lore (`storylineId` / `npcId` / `questId`)

> Tài liệu này phục vụ Requirement 4.4 của spec `storyline-scoped-npc-chatbot`.
> Mục tiêu: ghi rõ các chuỗi định danh dùng trong front matter của corpus lore,
> để **backend truyền cùng giá trị** khi gọi `Lore_Search` (`POST /v1/lore/search`).
> Front matter và giá trị backend phải khớp **tuyệt đối** (phân biệt hoa/thường,
> dấu gạch dưới), nếu không scoping cốt truyện sẽ không có hiệu lực.

## Quy ước chung

- Lore có thể truy hồi nằm trong `RAG_CORPUS_DIR` (mặc định `data/lore-corpus`).
- Nội dung policy/cấm nằm trong `RAG_POLICY_DIR` (mặc định `data/lore-policy`) và
  **không bao giờ** được trả về bởi `Lore_Search` (Requirement 4.5).
- Mỗi file markdown có thể mang front matter (YAML giữa `---`) với ba khóa:
  - `storylineId`: gắn đoạn lore vào một cốt truyện cụ thể.
  - `npcId`: gắn đoạn lore vào một NPC cụ thể (tùy chọn).
  - `questId`: gắn đoạn lore vào một mốc quest cụ thể, dùng cho gating chống
    spoiler (tùy chọn).
- File **không có** `storylineId` được coi là `Shared_Lore` (dùng chung cho mọi
  cốt truyện) — ví dụ thông tin thế giới/vùng đất nền.

## Nguồn sự thật của định danh

Các chuỗi định danh dưới đây lấy trực tiếp từ `STORYLINE_REGISTRY` của backend:
`Adventura-backend/src/data/storylines/storyline-registry.ts` (entry `thanh_giong`).
Backend phân giải `storylineId` từ `player.character.storylineState.currentStorylineId`
và truyền `npcId` từ `NpcDefinition.id` của NPC đang hội thoại.

### `storylineId`

| `storylineId` | Tên hiển thị | Ghi chú |
| --- | --- | --- |
| `thanh_giong` | Thánh Gióng | Cốt truyện vertical-slice đầu tiên đã có corpus. |

### `npcId` (Thánh Gióng)

Lấy từ `STORYLINE_REGISTRY.thanh_giong.npcDialogueRootIds`:

| `npcId` | Vai trò | Dialogue root id (backend) |
| --- | --- | --- |
| `tg_village_elder_npc` | Trưởng làng Phù Đổng | `thanh_giong_village_elder` |
| `tg_court_scholar_npc` | Nho sĩ triều đình | `thanh_giong_scholar` |
| `tg_saint_giong_npc` | Thánh Gióng (chặng kết) | `thanh_giong_finale` |

### `questId` (Thánh Gióng — dùng trong corpus)

Lấy từ `STORYLINE_REGISTRY.thanh_giong.requiredQuestIds`. Hiện corpus mới gắn các
mốc sau (các `questId` còn lại trong registry hợp lệ để dùng về sau):

| `questId` | Mốc cốt truyện |
| --- | --- |
| `quest_tg_01_omen_of_war` | Điềm báo giặc Ân |
| `quest_tg_04_trial_of_the_request` | Lời thỉnh cầu của Gióng (bốn vật bằng sắt) |
| `quest_tg_06_forge_iron_gear` | Rèn binh khí bằng sắt |
| `quest_tg_11_iron_breaks_bamboo_rises` | Roi sắt gãy, luỹ tre hoá vũ khí |
| `quest_tg_13_return_to_sky` | Bay về trời ở núi Sóc |

## Ánh xạ file corpus → định danh

### Lore Thánh Gióng (`storylineId: thanh_giong`)

| File | `storylineId` | `npcId` | `questId` |
| --- | --- | --- | --- |
| `thanh-giong-world.md` | `thanh_giong` | — | — |
| `thanh-giong-village-elder.md` | `thanh_giong` | `tg_village_elder_npc` | — |
| `thanh-giong-court-scholar.md` | `thanh_giong` | `tg_court_scholar_npc` | — |
| `thanh-giong-omen-of-war.md` | `thanh_giong` | `tg_court_scholar_npc` | `quest_tg_01_omen_of_war` |
| `thanh-giong-iron-request.md` | `thanh_giong` | `tg_village_elder_npc` | `quest_tg_04_trial_of_the_request` |
| `thanh-giong-forge-iron-gear.md` | `thanh_giong` | — | `quest_tg_06_forge_iron_gear` |
| `thanh-giong-bamboo-rises.md` | `thanh_giong` | `tg_village_elder_npc` | `quest_tg_11_iron_breaks_bamboo_rises` |
| `thanh-giong-saint-giong.md` | `thanh_giong` | `tg_saint_giong_npc` | `quest_tg_13_return_to_sky` |

### Shared_Lore (không gắn `storylineId`)

Các file sau không có front matter `storylineId` nên đạt scope cho mọi cốt truyện:

| File | Nội dung |
| --- | --- |
| `world.md` | Thế giới, thần thoại sáng thế, Long Mạch |
| `regions.md` | Các vùng đất nền (Lạc Hồng Valley...) |
| `factions.md` | Các phe phái |
| `bloodlines.md` | Các dòng máu |
| `npc-personas.md` | Persona NPC dùng chung |

## Hợp đồng với backend (Lore_Search)

Khi xử lý intent `lore`/`smalltalk`, backend dựng `StorylineScope` rồi gọi
`Lore_Search` với đúng các chuỗi ở trên:

```jsonc
// POST /v1/lore/search
{
  "query": "<free text người chơi>",
  "topK": 4,
  "storylineId": "thanh_giong",          // = currentStorylineId của người chơi
  "npcId": "tg_village_elder_npc"        // = NpcDefinition.id của NPC đang hội thoại
}
```

Quy tắc lọc của `Lore_Search` (`matchesScope`):

- Khi request có `storylineId`, mọi chunk có `storylineId` **khác** bị loại; chunk
  `Shared_Lore` (không gắn `storylineId`) luôn được giữ.
- Khi request có `npcId`, mọi chunk có `npcId` **khác** bị loại; chunk không gắn
  `npcId` được giữ.
- `questId` dùng cho gating Unlocked_Content phía backend (chống spoiler): chunk
  gắn `questId` chỉ được đưa vào prompt khi `questId` đó nằm trong tập đã mở khóa
  của người chơi.

Thêm lore/NPC/quest mới: cập nhật `STORYLINE_REGISTRY` ở backend trước, rồi dùng
**đúng** các chuỗi đó trong front matter corpus và cập nhật bảng ở tài liệu này.
