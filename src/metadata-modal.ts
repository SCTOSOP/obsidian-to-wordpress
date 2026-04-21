import { App, Modal, Setting } from "obsidian";
import type { PostMetadataInput, TaxonomyTermResponse, WordPressPostStatus } from "./types";

export interface CategorySelectorActions {
  categories: TaxonomyTermResponse[];
  refresh(): Promise<TaxonomyTermResponse[]>;
  create(name: string, parent?: number): Promise<TaxonomyTermResponse>;
  delete(categoryId: number): Promise<void>;
}

export class MetadataModal extends Modal {
  private title: string;
  private slug = "";
  private status: WordPressPostStatus;
  private excerpt = "";
  private tags = "";
  private categories: TaxonomyTermResponse[];
  private selectedCategoryNames = new Set<string>();
  private newCategoryName = "";
  private newCategoryParentId = 0;

  constructor(
    app: App,
    defaults: { title: string; status: WordPressPostStatus },
    private onSubmit: (input: PostMetadataInput) => void,
    private categoryActions?: CategorySelectorActions,
  ) {
    super(app);
    this.title = defaults.title;
    this.status = defaults.status;
    this.categories = categoryActions?.categories ?? [];
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Publish to WordPress" });
    contentEl.createEl("p", {
      text: "This note has no WordPress mapping yet. Fill the fields below; they will be saved to the note frontmatter.",
    });

    new Setting(contentEl)
      .setName("Title")
      .setDesc("Required. WordPress post title.")
      .addText((text) => text
        .setValue(this.title)
        .onChange((value) => { this.title = value; }));

    new Setting(contentEl)
      .setName("Slug")
      .setDesc("Optional. Leave blank to let WordPress generate it.")
      .addText((text) => text
        .setPlaceholder("my-post-slug")
        .setValue(this.slug)
        .onChange((value) => { this.slug = value; }));

    new Setting(contentEl)
      .setName("Status")
      .setDesc("Required. Draft is safest for the first publish.")
      .addDropdown((dropdown) => dropdown
        .addOption("draft", "Draft")
        .addOption("publish", "Publish")
        .addOption("private", "Private")
        .addOption("pending", "Pending")
        .setValue(this.status)
        .onChange((value) => { this.status = value as WordPressPostStatus; }));

    new Setting(contentEl)
      .setName("Excerpt")
      .setDesc("Optional.")
      .addTextArea((text) => text
        .setValue(this.excerpt)
        .onChange((value) => { this.excerpt = value; }));

    this.renderCategorySelector(contentEl);

    new Setting(contentEl)
      .setName("Tags")
      .setDesc("Optional comma-separated tag names. Missing terms will be created.")
      .addText((text) => text
        .setPlaceholder("obsidian, wordpress")
        .setValue(this.tags)
        .onChange((value) => { this.tags = value; }));

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Cancel")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText("Save and publish")
        .onClick(() => {
          const title = this.title.trim();
          if (!title) {
            this.contentEl.createEl("p", { text: "Title is required.", cls: "mod-warning" });
            return;
          }

          this.onSubmit({
            title,
            slug: emptyToUndefined(this.slug),
            status: this.status,
            excerpt: emptyToUndefined(this.excerpt),
            categories: Array.from(this.selectedCategoryNames),
            tags: splitCsv(this.tags),
          });
          this.close();
        }));
  }

  private renderCategorySelector(contentEl: HTMLElement): void {
    contentEl.createEl("h3", { text: "Categories" });
    contentEl.createEl("p", {
      text: this.categoryActions
        ? "Select WordPress categories. You can add or delete categories directly here."
        : "WordPress categories could not be loaded; publish will continue without categories.",
    });

    if (!this.categoryActions) return;

    new Setting(contentEl)
      .setName("Add category")
      .addText((text) => text
        .setPlaceholder("New category name")
        .setValue(this.newCategoryName)
        .onChange((value) => { this.newCategoryName = value; }))
      .addDropdown((dropdown) => {
        dropdown.addOption("0", "No parent");
        flattenCategoryTree(this.categories).forEach(({ category, depth }) => {
          dropdown.addOption(String(category.id), `${"  ".repeat(depth)}${depth > 0 ? "- " : ""}${category.name}`);
        });
        dropdown.setValue(String(this.newCategoryParentId));
        dropdown.onChange((value) => { this.newCategoryParentId = Number(value) || 0; });
      })
      .addButton((button) => button
        .setButtonText("Add")
        .onClick(async () => {
          const name = this.newCategoryName.trim();
          if (!name) return;
          const created = await this.categoryActions?.create(name, this.newCategoryParentId || undefined);
          if (created) {
            this.selectedCategoryNames.add(created.name);
            this.newCategoryName = "";
            this.newCategoryParentId = 0;
            this.categories = await this.categoryActions!.refresh();
            this.render();
          }
        }))
      .addButton((button) => button
        .setButtonText("Refresh")
        .onClick(async () => {
          this.categories = await this.categoryActions!.refresh();
          this.render();
        }));

    if (this.categories.length === 0) {
      contentEl.createEl("p", { text: "No categories found." });
      return;
    }

    flattenCategoryTree(this.categories).forEach(({ category, depth }) => {
      new Setting(contentEl)
        .setName(`${"  ".repeat(depth)}${depth > 0 ? "- " : ""}${category.name}`)
        .setDesc(`slug: ${category.slug}`)
        .addToggle((toggle) => toggle
          .setValue(this.selectedCategoryNames.has(category.name))
          .onChange((value) => {
            if (value) this.selectedCategoryNames.add(category.name);
            else this.selectedCategoryNames.delete(category.name);
          }))
        .addButton((button) => button
          .setWarning()
          .setButtonText("Delete")
          .onClick(async () => {
            await this.categoryActions!.delete(category.id);
            this.selectedCategoryNames.delete(category.name);
            this.categories = await this.categoryActions!.refresh();
            this.render();
          }));
    });
  }
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function flattenCategoryTree(categories: TaxonomyTermResponse[]): Array<{ category: TaxonomyTermResponse; depth: number }> {
  const byParent = new Map<number, TaxonomyTermResponse[]>();
  const byId = new Map(categories.map((category) => [category.id, category]));

  categories.forEach((category) => {
    const parent = category.parent && byId.has(category.parent) ? category.parent : 0;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(category);
    byParent.set(parent, siblings);
  });

  byParent.forEach((siblings) => siblings.sort((left, right) => left.name.localeCompare(right.name)));

  const output: Array<{ category: TaxonomyTermResponse; depth: number }> = [];
  const visited = new Set<number>();

  const visit = (parent: number, depth: number) => {
    for (const category of byParent.get(parent) ?? []) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      output.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };

  visit(0, 0);

  categories.forEach((category) => {
    if (!visited.has(category.id)) output.push({ category, depth: 0 });
  });

  return output;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
