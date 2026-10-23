import { ChangeDetectionStrategy, Component } from '@angular/core';
import { consentCategories, storageRegister } from '@novan/marketing-content';

/** Every cookie and storage item the site uses, from the register the consent manager also reads. */
@Component({
  selector: 'mk-storage-table',
  template: `
    <div class="table-responsive mk-table-scroll">
      <table class="table mk-table">
        <caption>Cookies and storage this website uses</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Purpose</th>
            <th scope="col">Provider</th>
            <th scope="col">Duration</th>
            <th scope="col">Category</th>
            <th scope="col">Type</th>
          </tr>
        </thead>
        <tbody>
          @for (item of items; track item.name) {
            <tr>
              <th scope="row"><code>{{ item.name }}</code></th>
              <td>{{ item.purpose }}</td>
              <td>{{ item.provider }}</td>
              <td>{{ item.duration }}</td>
              <td>{{ item.categoryName }}</td>
              <td>{{ item.kind }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkStorageTable {
  protected readonly items = storageRegister.map((item) => ({
    ...item,
    categoryName: consentCategories.find((category) => category.id === item.category)?.name ?? item.category,
  }));
}
