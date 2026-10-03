import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DsAlertComponent,
  DsBadgeComponent,
  DsButtonComponent,
  DsModalComponent,
  DsSpinnerComponent,
} from '@black-isle-beef/novan-design-system';
import { AuthService } from '@novan/admin-auth';
import type { Member, SpaceRole } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ManagementApi } from '../management-api';
import { problemMessage } from '../problem';
import { isSpaceRole, roleLabel, roleOptions } from '../roles';
import { SpaceContext } from '../space-context';

/** People with access to a space: list, invite, change role, remove. */
@Component({
  selector: 'nv-members-page',
  imports: [
    DsAlertComponent,
    DsBadgeComponent,
    DsButtonComponent,
    DsModalComponent,
    DsSpinnerComponent,
    ReactiveFormsModule,
  ],
  templateUrl: './members-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembersPage {
  private readonly api = inject(ManagementApi);
  protected readonly auth = inject(AuthService);
  protected readonly context = inject(SpaceContext);

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly roleOptions = roleOptions;
  protected readonly roleLabel = roleLabel;
  protected readonly members = signal<Member[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly inviting = signal(false);
  protected readonly inviteSubmitted = signal(false);
  protected readonly removing = signal<Member | null>(null);
  protected readonly removeHeading = computed(() => {
    const member = this.removing();
    return member ? `Remove ${this.nameOf(member)}?` : 'Remove person?';
  });

  protected readonly inviteForm = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    role: ['editor' as SpaceRole, Validators.required],
  });

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
  }

  protected inviteEmailInvalid(): boolean {
    return this.inviteSubmitted() && this.inviteForm.controls.email.invalid;
  }

  protected isYou(member: Member): boolean {
    return member.userId === this.auth.claims()?.sub;
  }

  protected async invite(): Promise<void> {
    this.inviteSubmitted.set(true);
    this.clearMessages();
    if (this.inviteForm.invalid) return;

    const { email, role } = this.inviteForm.getRawValue();
    this.inviting.set(true);
    try {
      const member = await firstValueFrom(this.api.invite(this.spaceId(), { email: email.trim(), role }));
      this.members.update((list) => [...(list ?? []).filter((m) => m.userId !== member.userId), member]);
      this.status.set(`Invited ${email.trim()} as ${roleLabel(role).toLowerCase()}.`);
      this.inviteForm.reset();
      this.inviteSubmitted.set(false);
    } catch (error) {
      this.actionError.set(problemMessage(error));
    } finally {
      this.inviting.set(false);
    }
  }

  protected async changeRole(member: Member, select: HTMLSelectElement): Promise<void> {
    this.clearMessages();
    const role = select.value;
    if (!isSpaceRole(role) || role === member.role) return;
    try {
      const updated = await firstValueFrom(this.api.changeRole(this.spaceId(), member.userId, role));
      this.replace(updated);
      this.status.set(`${this.nameOf(member)} is now ${roleLabel(role).toLowerCase()}.`);
    } catch (error) {
      this.actionError.set(problemMessage(error));
      // Show the role that is still saved.
      select.value = member.role;
    }
  }

  protected confirmRemove(member: Member): void {
    this.clearMessages();
    this.removing.set(member);
  }

  protected async remove(): Promise<void> {
    const member = this.removing();
    this.removing.set(null);
    if (!member) return;
    try {
      await firstValueFrom(this.api.removeMember(this.spaceId(), member.userId));
      this.members.update((list) => (list ?? []).filter((m) => m.userId !== member.userId));
      this.status.set(`${this.nameOf(member)} no longer has access.`);
    } catch (error) {
      this.actionError.set(problemMessage(error));
    }
  }

  protected nameOf(member: Member): string {
    return member.displayName ?? 'This person';
  }

  private async load(spaceId: string): Promise<void> {
    this.members.set(null);
    this.loadError.set(null);
    this.clearMessages();
    try {
      this.members.set(await firstValueFrom(this.api.listMembers(spaceId)));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }

  private replace(member: Member): void {
    this.members.update((list) => (list ?? []).map((m) => (m.userId === member.userId ? member : m)));
  }

  private clearMessages(): void {
    this.status.set(null);
    this.actionError.set(null);
  }
}
