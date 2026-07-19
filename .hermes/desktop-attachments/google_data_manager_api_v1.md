# Package google.ads.datamanager.v1 — Data Manager API

> **Source:** [Package google.ads.datamanager.v1 | Data Manager API | Google for Developers](https://developers.google.com/data-manager/api/reference/rpc/google.ads.datamanager.v1)
>
> **Service name:** `datamanager.googleapis.com`
>
> **OAuth scope:** `https://www.googleapis.com/auth/datamanager`

---

## Overview

The Data Manager API allows data partners, agencies, and advertisers to connect first-party data across Google advertising products. Key capabilities:

- The **IngestionService** allows uploading and removing audience data to supported destinations through methods like `IngestAudienceMembers` and `RemoveAudienceMembers`.
- The API supports different types of identifiers for audience members and events, including user-provided data, PAIR IDs, and mobile device data.
- Detailed status information for requests can be retrieved using the `RetrieveRequestStatus` method, including success, processing, failed, or partial success statuses per destination.
- Data can be encrypted using Google Cloud Platform or AWS wrapped keys.
- User data and events can include consent information for DMA compliance and advertiser-assessed user properties.

---

## Index

### Interfaces (Services)

- [IngestionService](#ingestionservice)
- [MarketingDataInsightsService](#marketingdatainsightsservice)
- [PartnerLinkService](#partnerlinkservice)
- [UserListDirectLicenseService](#userlistdirectlicenseservice)
- [UserListGlobalLicenseService](#userlistgloballicenseservice)
- [UserListService](#userlistservice)

### Messages

- [AdIdentifiers](#adidentifiers)
- [AddressInfo](#addressinfo)
- [AudienceMember](#audiencemember)
- [AwsWrappedKeyInfo](#awswrappedkeyinfo)
- [Baseline](#baseline)
- [Baseline.Location](#baselinelocation)
- [CartData](#cartdata)
- [CompositeData](#compositedata)
- [Consent](#consent)
- [ContactIdInfo](#contactidinfo)
- [CreatePartnerLinkRequest](#createpartnerlinkrequest)
- [CreateUserListDirectLicenseRequest](#createuserlistdirectlicenserequest)
- [CreateUserListGlobalLicenseRequest](#createuserlistgloballicenserequest)
- [CreateUserListRequest](#createuserlistrequest)
- [CustomVariable](#customvariable)
- [DeletePartnerLinkRequest](#deletepartnerlinkrequest)
- [DeleteUserListRequest](#deleteuserlistrequest)
- [Destination](#destination)
- [DeviceInfo](#deviceinfo)
- [EncryptedUserId](#encrypteduserid)
- [EncryptionInfo](#encryptioninfo)
- [ErrorCount](#errorcount)
- [ErrorInfo](#errorinfo)
- [Event](#event)
- [EventLocation](#eventlocation)
- [EventParameter](#eventparameter)
- [ExperimentalField](#experimentalfield)
- [GcpWrappedKeyInfo](#gcpwrappedkeyinfo)
- [GetUserListDirectLicenseRequest](#getuserlistdirectlicenserequest)
- [GetUserListGlobalLicenseRequest](#getuserlistgloballicenserequest)
- [GetUserListRequest](#getuserlistrequest)
- [IngestAudienceMembersRequest](#ingestaudiencemembersrequest)
- [IngestAudienceMembersResponse](#ingestaudiencemembersresponse)
- [IngestEventsRequest](#ingesteventsrequest)
- [IngestEventsResponse](#ingesteventsresponse)
- [IngestedUserListInfo](#ingesteduserlistinfo)
- [IpData](#ipdata)
- [Item](#item)
- [ItemCustomVariable](#itemcustomvariable)
- [ItemParameter](#itemparameter)
- [ListUserListDirectLicensesRequest](#listuserlistdirectlicensesrequest)
- [ListUserListDirectLicensesResponse](#listuserlistdirectlicensesresponse)
- [ListUserListGlobalLicenseCustomerInfosRequest](#listuserlistgloballicensecustomerinfosrequest)
- [ListUserListGlobalLicenseCustomerInfosResponse](#listuserlistgloballicensecustomerinfosresponse)
- [ListUserListGlobalLicensesRequest](#listuserlistgloballicensesrequest)
- [ListUserListGlobalLicensesResponse](#listuserlistgloballicensesresponse)
- [ListUserListsRequest](#listuserlistsrequest)
- [ListUserListsResponse](#listuserlistsresponse)
- [MobileData](#mobiledata)
- [MobileIdInfo](#mobileidinfo)
- [PairData](#pairdata)
- [PairIdInfo](#pairidinfo)
- [PartnerAudienceInfo](#partneraudienceinfo)
- [PartnerLink](#partnerlink)
- [PpidData](#ppiddata)
- [ProductAccount](#productaccount)
- [PseudonymousIdInfo](#pseudonymousidinfo)
- [RemoveAudienceMembersRequest](#removeaudiencemembersrequest)
- [RemoveAudienceMembersResponse](#removeaudiencemembersresponse)
- [RequestStatusPerDestination](#requeststatusperdestination)
- [RequestStatusPerDestination.DataTypeCount](#requeststatusperdestinationdatatypecount)
- [RequestStatusPerDestination.IngestAudienceMembersStatus](#requeststatusperdestinationingestaudiencemembersstatus)
- [RequestStatusPerDestination.IngestCompositeDataStatus](#requeststatusperdestinationingestcompositedatastatus)
- [RequestStatusPerDestination.IngestEventsStatus](#requeststatusperdestinationingesteventsstatus)
- [RequestStatusPerDestination.IngestMobileDataStatus](#requeststatusperdestinationingestmobiledatastatus)
- [RequestStatusPerDestination.IngestPairDataStatus](#requeststatusperdestinationingestpairdatastatus)
- [RequestStatusPerDestination.IngestPpidDataStatus](#requeststatusperdestinationingestppiddatastatus)
- [RequestStatusPerDestination.IngestUserDataStatus](#requeststatusperdestinationingestuserdatastatus)
- [RequestStatusPerDestination.IngestUserIdDataStatus](#requeststatusperdestinationingestuseriddatastatus)
- [RequestStatusPerDestination.RemoveAudienceMembersStatus](#requeststatusperdestinationremoveaudiencemembersstatus)
- [RequestStatusPerDestination.RemoveCompositeDataStatus](#requeststatusperdestinationremovecompositedatastatus)
- [RequestStatusPerDestination.RemoveMobileDataStatus](#requeststatusperdestinationremovemobiledatastatus)
- [RequestStatusPerDestination.RemovePairDataStatus](#requeststatusperdestinationremovepairdatastatus)
- [RequestStatusPerDestination.RemovePpidDataStatus](#requeststatusperdestinationremoveppiddatastatus)
- [RequestStatusPerDestination.RemoveUserDataStatus](#requeststatusperdestinationremoveuserdatastatus)
- [RequestStatusPerDestination.RemoveUserIdDataStatus](#requeststatusperdestinationremoveuseriddatastatus)
- [RetrieveInsightsRequest](#retrieveinsightsrequest)
- [RetrieveInsightsResponse](#retrieveinsightsresponse)
- [RetrieveInsightsResponse.MarketingDataInsight](#retrieveinsightsresponsemarketingdatainsight)
- [RetrieveInsightsResponse.MarketingDataInsight.MarketingDataInsightsAttribute](#retrieveinsightsresponsemarketingdatainsightmarketingdatainsightsattribute)
- [RetrieveRequestStatusRequest](#retrieverequeststatusrequest)
- [RetrieveRequestStatusResponse](#retrieverequeststatusresponse)
- [SearchPartnerLinksRequest](#searchpartnerlinksrequest)
- [SearchPartnerLinksResponse](#searchpartnerlinksresponse)
- [SizeInfo](#sizeinfo)
- [TargetNetworkInfo](#targetnetworkinfo)
- [TermsOfService](#termsofservice)
- [UpdateUserListDirectLicenseRequest](#updateuserlistdirectlicenserequest)
- [UpdateUserListGlobalLicenseRequest](#updateuserlistgloballicenserequest)
- [UpdateUserListRequest](#updateuserlistrequest)
- [UserData](#userdata)
- [UserIdData](#useriddata)
- [UserIdInfo](#useridinfo)
- [UserIdentifier](#useridentifier)
- [UserList](#userlist)
- [UserListDirectLicense](#userlistdirectlicense)
- [UserListGlobalLicense](#userlistgloballicense)
- [UserListGlobalLicenseCustomerInfo](#userlistgloballicensecustomerinfo)
- [UserListLicenseMetrics](#userlistlicensemetrics)
- [UserListLicensePricing](#userlistlicensepricing)
- [UserProperties](#userproperties)
- [UserProperty](#userproperty)
- [WarningCount](#warningcount)
- [WarningInfo](#warninginfo)

### Enums

- [AgeRange](#agerange)
- [AwsWrappedKeyInfo.KeyType](#awswrappedkeyinfokeytype)
- [ConsentStatus](#consentstatus)
- [CustomerType](#customertype)
- [CustomerValueBucket](#customervaluebucket)
- [DataSourceType](#datasourcetype)
- [Encoding](#encoding)
- [EncryptedUserId.EncryptionEntityType](#encrypteduseridencryptionentitytype)
- [EncryptedUserId.EncryptionSource](#encrypteduseridencryptionsource)
- [ErrorReason](#errorreason)
- [EventSource](#eventsource)
- [GcpWrappedKeyInfo.KeyType](#gcpwrappedkeyinfokeytype)
- [Gender](#gender)
- [IngestedUserListInfo.UploadKeyType](#ingesteduserlistinfouploadkeytype)
- [MatchRateRange](#matchraterange)
- [MobileIdInfo.KeySpace](#mobileidinfokeyspace)
- [PartnerAudienceInfo.PartnerAudienceSource](#partneraudienceinfopartneraudiencesource)
- [ProcessingErrorReason](#processingerrorreason)
- [ProcessingWarningReason](#processingwarningreason)
- [Product](#product) *(deprecated)*
- [ProductAccount.AccountType](#productaccountaccounttype)
- [PseudonymousIdInfo.SyncStatus](#pseudonymousidinfosyncstatus)
- [RequestStatusPerDestination.DataType](#requeststatusperdestinationdatatype)
- [RequestStatusPerDestination.RequestStatus](#requeststatusperdestinationrequeststatus)
- [RetrieveInsightsResponse.MarketingDataInsight.AudienceInsightsDimension](#retrieveinsightsresponsemarketingdatainsightaudienceinsightsdimension)
- [TermsOfServiceStatus](#termsofservicestatus)
- [UserList.AccessReason](#userlistaccessreason)
- [UserList.AccessStatus](#userlistaccessstatus)
- [UserList.ClosingReason](#userlistclosingreason)
- [UserList.MembershipStatus](#userlistmembershipstatus)
- [UserListGlobalLicenseType](#userlistgloballicensetype)
- [UserListLicenseClientAccountType](#userlistlicenseclientaccounttype)
- [UserListLicensePricing.UserListPricingBuyerApprovalState](#userlistlicensepricinguserlistpricingbuyerapprovalstate)
- [UserListLicensePricing.UserListPricingCostType](#userlistlicensepricinguserlistpricingcosttype)
- [UserListLicenseStatus](#userlistlicensestatus)

---

## Services

---

### IngestionService

Service for sending audience data to supported destinations.

#### IngestAudienceMembers

```
rpc IngestAudienceMembers(IngestAudienceMembersRequest) returns (IngestAudienceMembersResponse)
```

Uploads a list of `AudienceMember` resources to the provided `Destination`.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### IngestEvents

```
rpc IngestEvents(IngestEventsRequest) returns (IngestEventsResponse)
```

Uploads a list of `Event` resources from the provided `Destination`.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### RemoveAudienceMembers

```
rpc RemoveAudienceMembers(RemoveAudienceMembersRequest) returns (RemoveAudienceMembersResponse)
```

Removes a list of `AudienceMember` resources from the provided `Destination`.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### RetrieveRequestStatus

```
rpc RetrieveRequestStatus(RetrieveRequestStatusRequest) returns (RetrieveRequestStatusResponse)
```

Gets the status of a request given a request ID.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

### MarketingDataInsightsService

Service to return insights on marketing data.

> **Note:** This feature is only available to data partners.

#### RetrieveInsights

```
rpc RetrieveInsights(RetrieveInsightsRequest) returns (RetrieveInsightsResponse)
```

Retrieves marketing data insights for a given user list. This feature is only available to data partners.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | The resource name of the account where the Google Account of the credentials is a user. If not set, defaults to the account of the request. Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |
| `linked-account` | The resource name of the account with an established product link to the `login-account`. Format: `accountTypes/{linkedAccountType}/accounts/{linkedAccountId}` |

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

### PartnerLinkService

Service for managing partner links.

#### CreatePartnerLink

```
rpc CreatePartnerLink(CreatePartnerLinkRequest) returns (PartnerLink)
```

Creates a partner link for the given account.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | The resource name of the account where the Google Account of the credentials is a user. Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |

**Authorization:** Requires one of:
- `https://www.googleapis.com/auth/datamanager`
- `https://www.googleapis.com/auth/datamanager.partnerlink`

---

#### DeletePartnerLink

```
rpc DeletePartnerLink(DeletePartnerLinkRequest) returns (google.protobuf.Empty)
```

Deletes a partner link for the given account.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |

**Authorization:** Requires one of:
- `https://www.googleapis.com/auth/datamanager`
- `https://www.googleapis.com/auth/datamanager.partnerlink`

---

#### SearchPartnerLinks

```
rpc SearchPartnerLinks(SearchPartnerLinksRequest) returns (SearchPartnerLinksResponse)
```

Searches for all partner links to and from a given account.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |

**Authorization:** Requires one of:
- `https://www.googleapis.com/auth/datamanager`
- `https://www.googleapis.com/auth/datamanager.partnerlink`

---

### UserListDirectLicenseService

Service for managing user list direct licenses.

> **Note:** Delete is not a supported operation. To deactivate a license, update its status to `DISABLED`. This feature is only available to data partners.

#### CreateUserListDirectLicense

```
rpc CreateUserListDirectLicense(CreateUserListDirectLicenseRequest) returns (UserListDirectLicense)
```

Creates a user list direct license. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### GetUserListDirectLicense

```
rpc GetUserListDirectLicense(GetUserListDirectLicenseRequest) returns (UserListDirectLicense)
```

Retrieves a user list direct license. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### ListUserListDirectLicenses

```
rpc ListUserListDirectLicenses(ListUserListDirectLicensesRequest) returns (ListUserListDirectLicensesResponse)
```

Lists all user list direct licenses owned by the parent account. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### UpdateUserListDirectLicense

```
rpc UpdateUserListDirectLicense(UpdateUserListDirectLicenseRequest) returns (UserListDirectLicense)
```

Updates a user list direct license. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

### UserListGlobalLicenseService

Service for managing user list global licenses.

> **Note:** Delete is not a supported operation. To deactivate a license, update its status to `DISABLED`. This feature is only available to data partners.

#### CreateUserListGlobalLicense

```
rpc CreateUserListGlobalLicense(CreateUserListGlobalLicenseRequest) returns (UserListGlobalLicense)
```

Creates a user list global license. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### GetUserListGlobalLicense

```
rpc GetUserListGlobalLicense(GetUserListGlobalLicenseRequest) returns (UserListGlobalLicense)
```

Retrieves a user list global license. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### ListUserListGlobalLicenseCustomerInfos

```
rpc ListUserListGlobalLicenseCustomerInfos(ListUserListGlobalLicenseCustomerInfosRequest) returns (ListUserListGlobalLicenseCustomerInfosResponse)
```

Lists all customer info for a user list global license. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### ListUserListGlobalLicenses

```
rpc ListUserListGlobalLicenses(ListUserListGlobalLicensesRequest) returns (ListUserListGlobalLicensesResponse)
```

Lists all user list global licenses owned by the parent account. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### UpdateUserListGlobalLicense

```
rpc UpdateUserListGlobalLicense(UpdateUserListGlobalLicenseRequest) returns (UserListGlobalLicense)
```

Updates a user list global license. Only available to data partners.

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

### UserListService

Service for managing UserList resources.

#### CreateUserList

```
rpc CreateUserList(CreateUserListRequest) returns (UserList)
```

Creates a UserList.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |
| `linked-account` | Format: `accountTypes/{linkedAccountType}/accounts/{linkedAccountId}` |

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### DeleteUserList

```
rpc DeleteUserList(DeleteUserListRequest) returns (google.protobuf.Empty)
```

Deletes a UserList.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |
| `linked-account` | Format: `accountTypes/{linkedAccountType}/accounts/{linkedAccountId}` |

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### GetUserList

```
rpc GetUserList(GetUserListRequest) returns (UserList)
```

Gets a UserList.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |
| `linked-account` | Format: `accountTypes/{linkedAccountType}/accounts/{linkedAccountId}` |

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### ListUserLists

```
rpc ListUserLists(ListUserListsRequest) returns (ListUserListsResponse)
```

Lists UserLists.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |
| `linked-account` | Format: `accountTypes/{linkedAccountType}/accounts/{linkedAccountId}` |

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

#### UpdateUserList

```
rpc UpdateUserList(UpdateUserListRequest) returns (UserList)
```

Updates a UserList.

**Authorization Headers (optional):**

| Header | Description |
|--------|-------------|
| `login-account` | Format: `accountTypes/{loginAccountType}/accounts/{loginAccountId}` |
| `linked-account` | Format: `accountTypes/{linkedAccountType}/accounts/{linkedAccountId}` |

**Authorization:** Requires OAuth scope `https://www.googleapis.com/auth/datamanager`

---

## Messages

---

### AdIdentifiers

Identifiers and other information used to match the conversion event with other online activity (such as ad clicks).

| Field | Type | Description |
|-------|------|-------------|
| `session_attributes` | `string` | Optional. Session attributes for event attribution and modeling. |
| `gclid` | `string` | Optional. The Google click ID (gclid) associated with this event. |
| `gbraid` | `string` | Optional. The click identifier for clicks associated with app events originating from iOS devices starting with iOS14. |
| `wbraid` | `string` | Optional. The click identifier for clicks associated with web events originating from iOS devices starting with iOS14. |
| `landing_page_device_info` | `DeviceInfo` | Optional. Information gathered about the device being used at the time of landing onto the advertiser's site after interacting with the ad. |
| `mobile_device_id` | `string` | Optional. The mobile identifier for advertisers (IDFA on iOS, AdID on Android, or other platform identifiers). |
| `dclid` | `string` | Optional. The display click ID associated with this event. |
| `impression_id` | `string` | Optional. The impression ID associated with this event. |
| `match_id` | `string` | Optional. The match ID field used to join this event with a previous event. |
| `encrypted_user_ids[]` | `EncryptedUserId` | Optional. Any number of encrypted user IDs. |

---

### AddressInfo

Address information for the user.

| Field | Type | Description |
|-------|------|-------------|
| `given_name` | `string` | Required. Given (first) name of the user, all lowercase, no punctuation, no leading/trailing whitespace, hashed as SHA-256. |
| `family_name` | `string` | Required. Family (last) name of the user, all lowercase, no punctuation, no leading/trailing whitespace, hashed as SHA-256. |
| `region_code` | `string` | Required. The 2-letter region code in ISO-3166-1 alpha-2 of the user's address. |
| `postal_code` | `string` | Required. The postal code of the user's address. |

---

### AudienceMember

The audience member to be operated on.

| Field | Type | Description |
|-------|------|-------------|
| `destination_references[]` | `string` | Optional. Defines which `Destination` to send the audience member to. |
| `consent` | `Consent` | Optional. The consent setting for the user. |

**Union field `data`** — the type of identifying data (only one of the following):

| Field | Type | Description |
|-------|------|-------------|
| `user_data` | `UserData` | User-provided data that identifies the user. |
| `pair_data` | `PairData` | Publisher Advertiser Identity Reconciliation (PAIR) IDs. Only available to data partners. |
| `mobile_data` | `MobileData` | Data identifying the user's mobile devices. |
| `user_id_data` | `UserIdData` | Data related to unique identifiers for a user, as defined by the advertiser. |
| `ppid_data` | `PpidData` | Data related to publisher provided identifiers. Only available to data partners. |
| `composite_data` | `CompositeData` | Group of multiple identifier types. |

---

### AwsWrappedKeyInfo

A data encryption key wrapped by an AWS KMS key.

| Field | Type | Description |
|-------|------|-------------|
| `key_type` | `AwsWrappedKeyInfo.KeyType` | Required. The type of algorithm used to encrypt the data. |
| `role_arn` | `string` | Required. The Amazon Resource Name of the IAM Role to assume for KMS decryption. Format: `arn:{partition}:iam::{account_id}:role/{role_name}` |
| `kek_uri` | `string` | Required. The URI of the AWS KMS key used to decrypt the DEK. Format: `arn:{partition}:kms:{region}:{account_id}:key/{key_id}` |
| `encrypted_dek` | `string` | Required. The base64 encoded encrypted data encryption key. |

---

### Baseline

Baseline criteria against which insights are compared.

**Union field `baseline`** (only one of the following):

| Field | Type | Description |
|-------|------|-------------|
| `baseline_location` | `Baseline.Location` | The baseline location of the request. Baseline location is an OR-list of requested regions. |
| `location_auto_detection_enabled` | `bool` | If true, the service will try to automatically detect the baseline location for insights. |

---

### Baseline.Location

The baseline location of the request. An OR-list of ISO 3166-1 alpha-2 region codes.

| Field | Type | Description |
|-------|------|-------------|
| `region_codes[]` | `string` | List of ISO 3166-1 alpha-2 region codes. |

---

### CartData

The cart data associated with the event.

| Field | Type | Description |
|-------|------|-------------|
| `merchant_id` | `string` | Optional. The Merchant Center ID associated with the items. |
| `merchant_feed_label` | `string` | Optional. The Merchant Center feed label associated with the feed of the items. |
| `merchant_feed_language_code` | `string` | Optional. The language code in ISO 639-1 associated with the Merchant Center feed of the items. |
| `transaction_discount` | `double` | Optional. The sum of all discounts associated with the transaction. |
| `items[]` | `Item` | Optional. The list of items associated with the event. |
| `coupon_codes[]` | `string` | Optional. The list of coupon codes applied to the cart. If the event is for a Google Analytics destination, only provide a single coupon code. |

---

### CompositeData

Composite data holding identifiers and associated data for a user. At least one of `user_data` or `ip_data` is required.

| Field | Type | Description |
|-------|------|-------------|
| `user_data` | `UserData` | Optional. User-provided data that identifies the user. |
| `ip_data[]` | `IpData` | Optional. IP address data representing customer interaction used to build the audience. |

---

### Consent

[Digital Markets Act (DMA)](https://digital-markets-act.ec.europa.eu/index_en) consent settings for the user.

| Field | Type | Description |
|-------|------|-------------|
| `ad_user_data` | `ConsentStatus` | Optional. Represents if the user consents to ad user data. |
| `ad_personalization` | `ConsentStatus` | Optional. Represents if the user consents to ad personalization. |

---

### ContactIdInfo

Additional information when `CONTACT_ID` is one of the `upload_key_types`.

| Field | Type | Description |
|-------|------|-------------|
| `match_rate_percentage` | `int32` | Output only. Match rate for customer match user lists. |
| `data_source_type` | `DataSourceType` | Optional. Immutable. Source of the upload data. |

---

### CreatePartnerLinkRequest

Request to create a `PartnerLink` resource.

| Field | Type | Description |
|-------|------|-------------|
| `parent` | `string` | Required. The parent account that owns this collection of partner links. Format: `accountTypes/{account_type}/accounts/{account}` |
| `partner_link` | `PartnerLink` | Required. The partner link to create. |

---

### CreateUserListDirectLicenseRequest

Request to create a `UserListDirectLicense` resource.

| Field | Type | Description |
|-------|------|-------------|
| `parent` | `string` | Required. The account that owns the user list being licensed. Format: `accountTypes/{ACCOUNT_TYPE}/accounts/{ACCOUNT_ID}` |
| `user_list_direct_license` | `UserListDirectLicense` | Required. The user list direct license to create. |

---

### CreateUserListGlobalLicenseRequest

Request to create a `UserListGlobalLicense` resource.

| Field | Type | Description |
|-------|------|-------------|
| `parent` | `string` | Required. The account that owns the user list being licensed. Format: `accountTypes/{ACCOUNT_TYPE}/accounts/{ACCOUNT_ID}` |
| `user_list_global_license` | `UserListGlobalLicense` | Required. The user list global license to create. |

---

### CreateUserListRequest

Request message for CreateUserList.

| Field | Type | Description |
|-------|------|-------------|
| `parent` | `string` | Required. The parent account. Format: `accountTypes/{account_type}/accounts/{account}` |
| `user_list` | `UserList` | Required. The user list to create. |
| `validate_only` | `bool` | Optional. If true, the request is validated but not executed. |

---

### CustomVariable

Custom variable for ads conversions.

| Field | Type | Description |
|-------|------|-------------|
| `variable` | `string` | Optional. The name of the custom variable to set. If not found for the given destination, it will be ignored. |
| `value` | `string` | Optional. The value to store for the custom variable. |
| `destination_references[]` | `string` | Optional. Reference string for which `Event.destination_references` the custom variable should be sent to. If empty, uses `Event.destination_references`. |

---

### DeletePartnerLinkRequest

Request to delete a `PartnerLink` resource.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Required. The resource name of the partner link to delete. Format: `accountTypes/{account_type}/accounts/{account}/partnerLinks/{partner_link}` |

---

### DeleteUserListRequest

Request message for DeleteUserList.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Required. The name of the user list to delete. Format: `accountTypes/{account_type}/accounts/{account}/userLists/{user_list}` |
| `validate_only` | `bool` | Optional. If true, the request is validated but not executed. |

---

### Destination

The Google product you're sending data to (e.g., a Google Ads account).

| Field | Type | Description |
|-------|------|-------------|
| `reference` | `string` | Optional. ID for this `Destination` resource, unique within the request. Use to reference this `Destination` in `IngestEventsRequest` and `IngestAudienceMembersRequest`. |
| `login_account` | `ProductAccount` | Optional. The account used to make this API call. Must have write access to the `operating_account`. |
| `linked_account` | `ProductAccount` | Optional. An account that the `login_account` has access to through an established account link. |
| `operating_account` | `ProductAccount` | Required. The account to send the data to or remove the data from. |
| `product_destination_id` | `string` | Required. The object within the product account to ingest into (e.g., a Google Ads audience ID, DV360 audience ID, or Google Ads conversion action ID). |

---

### DeviceInfo

Information about the device being used when the event happened.

| Field | Type | Description |
|-------|------|-------------|
| `user_agent` | `string` | Optional. The user-agent string of the device. |
| `ip_address` | `string` | Optional. The IP address of the device. **Note:** Google Ads does not support IP address matching for EEA, UK, or CH users. |
| `category` | `string` | Optional. The category of device (e.g., "desktop", "tablet", "mobile", "smart TV"). |
| `language_code` | `string` | Optional. The language the device uses in ISO 639-1 format. |
| `screen_height` | `int32` | Optional. The height of the screen in pixels. |
| `screen_width` | `int32` | Optional. The width of the screen in pixels. |
| `operating_system` | `string` | Optional. The operating system or platform of the device. |
| `operating_system_version` | `string` | Optional. The version of the operating system or platform. |
| `model` | `string` | Optional. The model of the device. |
| `brand` | `string` | Optional. The brand of the device. |
| `browser` | `string` | Optional. The brand or type of the browser. |
| `browser_version` | `string` | Optional. The version of the browser. |

---

### EncryptedUserId

A user identifier issued for attribution. All fields are required if this is used.

| Field | Type | Description |
|-------|------|-------------|
| `encrypted_id` | `string` | Required. The alphanumeric encrypted ID. |
| `entity_type` | `EncryptedUserId.EncryptionEntityType` | Required. The encryption entity type. Must match the encryption configuration for ad serving or Data Transfer. |
| `entity_id` | `int64` | Required. The encryption entity ID. Must match the encryption configuration for ad serving or Data Transfer. |
| `source` | `EncryptedUserId.EncryptionSource` | Required. Whether the encrypted cookie was received from ad serving (the %m macro) or from Data Transfer. |

---

### EncryptionInfo

Encryption information for the data being ingested.

**Union field `wrapped_key`** (only one of the following):

| Field | Type | Description |
|-------|------|-------------|
| `gcp_wrapped_key_info` | `GcpWrappedKeyInfo` | Google Cloud Platform wrapped key information. |
| `aws_wrapped_key_info` | `AwsWrappedKeyInfo` | Amazon Web Services wrapped key information. |

---

### ErrorCount

The error count for a given error reason.

| Field | Type | Description |
|-------|------|-------------|
| `record_count` | `int64` | The count of records that failed to upload for a given reason. |
| `reason` | `ProcessingErrorReason` | The error reason of the failed records. |

---

### ErrorInfo

Error counts for each type of error.

| Field | Type | Description |
|-------|------|-------------|
| `error_counts[]` | `ErrorCount` | A list of errors and counts per error reason. May not be populated in all cases. |

---

## Enums

---

### AgeRange

The demographic age ranges.

| Value | Description |
|-------|-------------|
| `AGE_RANGE_UNSPECIFIED` | Not specified. |
| `AGE_RANGE_UNKNOWN` | Unknown. |
| `AGE_RANGE_18_24` | Between 18 and 24 years old. |
| `AGE_RANGE_25_34` | Between 25 and 34 years old. |
| `AGE_RANGE_35_44` | Between 35 and 44 years old. |
| `AGE_RANGE_45_54` | Between 45 and 54 years old. |
| `AGE_RANGE_55_64` | Between 55 and 64 years old. |
| `AGE_RANGE_65_UP` | 65 years old and beyond. |

---

### AwsWrappedKeyInfo.KeyType

The type of algorithm used to encrypt the data.

| Value | Description |
|-------|-------------|
| `KEY_TYPE_UNSPECIFIED` | Unspecified key type. Should never be used. |
| `XCHACHA20_POLY1305` | Algorithm XChaCha20-Poly1305. |

---

### ConsentStatus

Represents if the user granted, denied, or hasn't specified consent.

| Value | Description |
|-------|-------------|
| `CONSENT_STATUS_UNSPECIFIED` | Not specified. |
| `CONSENT_GRANTED` | Granted. |
| `CONSENT_DENIED` | Denied. |

---

### CustomerType

Type of the customer associated with the event.

| Value | Description |
|-------|-------------|
| `CUSTOMER_TYPE_UNSPECIFIED` | Unspecified. Should never be used. |
| `NEW` | The customer is new to the advertiser. |
| `RETURNING` | The customer is returning to the advertiser. |
| `REENGAGED` | The customer has re-engaged with the advertiser. |

---

### CustomerValueBucket

The advertiser-assessed value of the customer.

| Value | Description |
|-------|-------------|
| `CUSTOMER_VALUE_BUCKET_UNSPECIFIED` | Unspecified. Should never be used. |
| `LOW` | The customer is low value. |
| `MEDIUM` | The customer is medium value. |
| `HIGH` | The customer is high value. |

---

### DataSourceType

Indicates the source of upload data.

| Value | Description |
|-------|-------------|
| `DATA_SOURCE_TYPE_UNSPECIFIED` | Not specified. |
| `DATA_SOURCE_TYPE_FIRST_PARTY` | The uploaded data is first-party data. |
| `DATA_SOURCE_TYPE_THIRD_PARTY_CREDIT_BUREAU` | The uploaded data is from a third-party credit bureau. |
| `DATA_SOURCE_TYPE_THIRD_PARTY_VOTER_FILE` | The uploaded data is from a third-party voter file. |
| `DATA_SOURCE_TYPE_THIRD_PARTY_PARTNER_DATA` | The uploaded data is third-party partner data. |

---

### Encoding

The encoding type of the hashed identifying information.

| Value | Description |
|-------|-------------|
| `ENCODING_UNSPECIFIED` | Unspecified. Should never be used. |
| `HEX` | Hex encoding. |
| `BASE64` | Base 64 encoding. |

---

### EncryptedUserId.EncryptionEntityType

The encryption entity type.

| Value | Description |
|-------|-------------|
| `ENCRYPTION_ENTITY_TYPE_UNSPECIFIED` | Unspecified encryption entity type. |
| `CAMPAIGN_MANAGER_ACCOUNT` | Campaign Manager 360 account. |
| `CAMPAIGN_MANAGER_ADVERTISER` | Campaign Manager 360 advertiser. |
| `DISPLAY_VIDEO_PARTNER` | Display & Video 360 partner. |
| `DISPLAY_VIDEO_ADVERTISER` | Display & Video 360 advertiser. |
| `GOOGLE_ADS_CUSTOMER` | Google Ads customer. |
| `GOOGLE_AD_MANAGER_NETWORK_CODE` | Google Ad Manager network code. |

---

### EncryptedUserId.EncryptionSource

The encryption source.

| Value | Description |
|-------|-------------|
| `ENCRYPTION_SOURCE_UNSPECIFIED` | Unspecified encryption source. |
| `AD_SERVING` | Ad serving encryption source. |
| `DATA_TRANSFER` | Data transfer encryption source. |

---

### ErrorReason

Error reasons for the Data Manager API.

> **Note:** This enum is not frozen — new values may be added in the future.

| Value | Description |
|-------|-------------|
| `ERROR_REASON_UNSPECIFIED` | Do not use this default value. |
| `INTERNAL_ERROR` | An internal error has occurred. |
| `DEADLINE_EXCEEDED` | The request took too long to respond. |
| `RESOURCE_EXHAUSTED` | Too many requests. |
| `NOT_FOUND` | Resource not found. |
| `PERMISSION_DENIED` | The user does not have permission or the resource is not found. |
| `INVALID_ARGUMENT` | There was a problem with the request. |
| `REQUIRED_FIELD_MISSING` | Required field is missing. |
| `INVALID_FORMAT` | Format is invalid. |
| `INVALID_HEX_ENCODING` | The HEX encoded value is malformed. |
| `INVALID_BASE64_ENCODING` | The base64 encoded value is malformed. |
| `INVALID_SHA256_FORMAT` | The SHA256 encoded value is malformed. |
| `INVALID_POSTAL_CODE` | Postal code is not valid. |
| `INVALID_COUNTRY_CODE` | *(Deprecated)* Enum is unused in the Data Manager API. |
| `INVALID_ENUM_VALUE` | Enum value cannot be used. |
| `INVALID_USER_LIST_TYPE` | Type of the user list is not applicable for this request. |
| `INVALID_AUDIENCE_MEMBER` | This audience member is not valid. |
| `TOO_MANY_AUDIENCE_MEMBERS` | Maximum number of audience members allowed per request is 10,000. |
| `TOO_MANY_USER_IDENTIFIERS` | Maximum number of user identifiers allowed per audience member is 10. |
| `TOO_MANY_DESTINATIONS` | Maximum number of destinations allowed per request is 10. |
| `INVALID_DESTINATION` | This Destination is not valid. |
| `DATA_PARTNER_USER_LIST_MUTATE_NOT_ALLOWED` | Data Partner does not have access to the operating account owned user list. |
| `INVALID_MOBILE_ID_FORMAT` | Mobile ID format is not valid. |
| `INVALID_USER_LIST_ID` | User list is not valid. |
| `MULTIPLE_DATA_TYPES_NOT_ALLOWED` | Multiple data types are not allowed to be ingested in a single request. |
| `DIFFERENT_LOGIN_ACCOUNTS_NOT_ALLOWED_FOR_DATA_PARTNER` | Destination configs containing a DataPartner login account must have the same login account across all destination configs. |
| `TERMS_AND_CONDITIONS_NOT_SIGNED` | Required terms and conditions are not accepted. |
| `INVALID_NUMBER_FORMAT` | Invalid number format. |
| `INVALID_CONVERSION_ACTION_ID` | Conversion action ID is not valid. |
| `INVALID_CONVERSION_ACTION_TYPE` | The conversion action type is not valid. |
| `INVALID_CURRENCY_CODE` | The currency code is not supported. |
| `INVALID_EVENT` | This event is not valid. |
| `TOO_MANY_EVENTS` | Maximum number of events allowed per request is 10,000. |
| `DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS` | The destination account is not enabled for enhanced conversions for leads. |
| `DESTINATION_ACCOUNT_DATA_POLICY_PROHIBITS_ENHANCED_CONVERSIONS` | Enhanced conversions can't be used for the destination account because of Google customer data policies. |
| `DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED` | The destination account hasn't agreed to the terms for enhanced conversions. |
| `DUPLICATE_DESTINATION_REFERENCE` | Two or more destinations in the request have the same reference. |
| `UNSUPPORTED_OPERATING_ACCOUNT_FOR_DATA_PARTNER` | Unsupported operating account for data partner authorization. |
| `UNSUPPORTED_LINKED_ACCOUNT_FOR_DATA_PARTNER` | Unsupported linked account for data partner authorization. |
| `NO_IDENTIFIERS_PROVIDED` | Events data contains no user identifiers or ad identifiers. For Floodlight Event ingestion, this error indicates requests contain no ad identifiers. |
| `INVALID_PROPERTY_TYPE` | The property type is not supported. |
| `INVALID_STREAM_TYPE` | The stream type is not supported. |
| `LINKED_ACCOUNT_ONLY_ALLOWED_WITH_DATA_PARTNER_LOGIN_ACCOUNT` | Linked account is only supported when the login account is a `DATA_PARTNER` account. |
| `OPERATING_ACCOUNT_LOGIN_ACCOUNT_MISMATCH` | The login account must be the same as the operating account for the given use case. |
| `EVENT_TIME_INVALID` | Event did not occur within the acceptable time window. |
| `RESERVED_NAME_USED` | Parameter uses a reserved name. |
| `INVALID_EVENT_NAME` | The event name is not supported. |
| `NOT_ALLOWLISTED` | The account is not allowlisted for the given feature. |
| `INVALID_REQUEST_ID` | The request ID used to retrieve the status of a request is not valid. Status can only be retrieved for requests that succeed and don't have `validate_only=true`. |
| `MULTIPLE_DESTINATIONS_FOR_GOOGLE_ANALYTICS_EVENT` | An event had 2 or more Google Analytics destinations. |
| `FIELD_VALUE_TOO_LONG` | Length of the field value is too long. |
| `FIELD_VALUE_TOO_SHORT` | Length of the field value is too short. |
| `TOO_MANY_ELEMENTS` | Too many elements in a list in the request. |
| `TOO_FEW_ELEMENTS` | Too few elements in a list in the request. |
| `ALREADY_EXISTS` | The resource already exists. |
| `IMMUTABLE_FIELD_FOR_UPDATE` | Attempted to set an immutable field for an update request. |
| `INVALID_RESOURCE_NAME` | The resource name is invalid. |
| `INVALID_FILTER` | The query filter is invalid. |

---

## Additional Types Referenced in the Index

The following types are defined in the API package but require the live documentation page for full field details. See the [official reference](https://developers.google.com/data-manager/api/reference/rpc/google.ads.datamanager.v1) for complete specifications.

### Messages

| Message | Description |
|---------|-------------|
| `Event` | An event to be ingested. |
| `EventLocation` | Location information for an event. |
| `EventParameter` | A parameter associated with an event. |
| `ExperimentalField` | An experimental field (subject to change). |
| `GcpWrappedKeyInfo` | A data encryption key wrapped by a GCP KMS key. |
| `GetUserListDirectLicenseRequest` | Request to retrieve a `UserListDirectLicense` resource. |
| `GetUserListGlobalLicenseRequest` | Request to retrieve a `UserListGlobalLicense` resource. |
| `GetUserListRequest` | Request message for GetUserList. |
| `IngestAudienceMembersRequest` | Request message for IngestAudienceMembers. |
| `IngestAudienceMembersResponse` | Response message for IngestAudienceMembers. |
| `IngestEventsRequest` | Request message for IngestEvents. |
| `IngestEventsResponse` | Response message for IngestEvents. |
| `IngestedUserListInfo` | Information about an ingested user list. |
| `IpData` | IP address data representing customer interaction. |
| `Item` | An item in a CartData. |
| `ItemCustomVariable` | A custom variable for an item. |
| `ItemParameter` | A parameter for an item. |
| `ListUserListDirectLicensesRequest` | Request to list `UserListDirectLicense` resources. |
| `ListUserListDirectLicensesResponse` | Response listing `UserListDirectLicense` resources. |
| `ListUserListGlobalLicenseCustomerInfosRequest` | Request to list customer infos for a global license. |
| `ListUserListGlobalLicenseCustomerInfosResponse` | Response listing customer infos. |
| `ListUserListGlobalLicensesRequest` | Request to list `UserListGlobalLicense` resources. |
| `ListUserListGlobalLicensesResponse` | Response listing `UserListGlobalLicense` resources. |
| `ListUserListsRequest` | Request message for ListUserLists. |
| `ListUserListsResponse` | Response message for ListUserLists. |
| `MobileData` | Data identifying the user's mobile devices. |
| `MobileIdInfo` | Mobile device identifier information. |
| `PairData` | Publisher Advertiser Identity Reconciliation (PAIR) ID data. |
| `PairIdInfo` | PAIR ID information. |
| `PartnerAudienceInfo` | Information about a partner audience. |
| `PartnerLink` | A link between two partner accounts. |
| `PpidData` | Publisher-provided identifier data. |
| `ProductAccount` | A product account (e.g., Google Ads account, DV360 account). |
| `PseudonymousIdInfo` | Pseudonymous identifier information. |
| `RemoveAudienceMembersRequest` | Request message for RemoveAudienceMembers. |
| `RemoveAudienceMembersResponse` | Response message for RemoveAudienceMembers. |
| `RequestStatusPerDestination` | Status of a request per destination. |
| `RequestStatusPerDestination.DataTypeCount` | Count of records per data type. |
| `RequestStatusPerDestination.IngestAudienceMembersStatus` | Status for IngestAudienceMembers per destination. |
| `RequestStatusPerDestination.IngestCompositeDataStatus` | Status for composite data ingestion per destination. |
| `RequestStatusPerDestination.IngestEventsStatus` | Status for IngestEvents per destination. |
| `RequestStatusPerDestination.IngestMobileDataStatus` | Status for mobile data ingestion per destination. |
| `RequestStatusPerDestination.IngestPairDataStatus` | Status for PAIR data ingestion per destination. |
| `RequestStatusPerDestination.IngestPpidDataStatus` | Status for PPID data ingestion per destination. |
| `RequestStatusPerDestination.IngestUserDataStatus` | Status for user data ingestion per destination. |
| `RequestStatusPerDestination.IngestUserIdDataStatus` | Status for user ID data ingestion per destination. |
| `RequestStatusPerDestination.RemoveAudienceMembersStatus` | Status for RemoveAudienceMembers per destination. |
| `RequestStatusPerDestination.RemoveCompositeDataStatus` | Status for composite data removal per destination. |
| `RequestStatusPerDestination.RemoveMobileDataStatus` | Status for mobile data removal per destination. |
| `RequestStatusPerDestination.RemovePairDataStatus` | Status for PAIR data removal per destination. |
| `RequestStatusPerDestination.RemovePpidDataStatus` | Status for PPID data removal per destination. |
| `RequestStatusPerDestination.RemoveUserDataStatus` | Status for user data removal per destination. |
| `RequestStatusPerDestination.RemoveUserIdDataStatus` | Status for user ID data removal per destination. |
| `RetrieveInsightsRequest` | Request message for RetrieveInsights. |
| `RetrieveInsightsResponse` | Response message for RetrieveInsights. |
| `RetrieveInsightsResponse.MarketingDataInsight` | A marketing data insight. |
| `RetrieveInsightsResponse.MarketingDataInsight.MarketingDataInsightsAttribute` | An attribute of a marketing data insight. |
| `RetrieveRequestStatusRequest` | Request message for RetrieveRequestStatus. |
| `RetrieveRequestStatusResponse` | Response message for RetrieveRequestStatus. |
| `SearchPartnerLinksRequest` | Request message for SearchPartnerLinks. |
| `SearchPartnerLinksResponse` | Response message for SearchPartnerLinks. |
| `SizeInfo` | Size information for a user list. |
| `TargetNetworkInfo` | Target network information. |
| `TermsOfService` | Terms of service information. |
| `UpdateUserListDirectLicenseRequest` | Request to update a `UserListDirectLicense` resource. |
| `UpdateUserListGlobalLicenseRequest` | Request to update a `UserListGlobalLicense` resource. |
| `UpdateUserListRequest` | Request message for UpdateUserList. |
| `UserData` | User-provided data that identifies the user. |
| `UserIdData` | Data related to unique identifiers for a user as defined by the advertiser. |
| `UserIdInfo` | User ID identifier information. |
| `UserIdentifier` | A user identifier. |
| `UserList` | A UserList resource. |
| `UserListDirectLicense` | A direct license for a user list. |
| `UserListGlobalLicense` | A global license for a user list. |
| `UserListGlobalLicenseCustomerInfo` | Customer info for a global license. |
| `UserListLicenseMetrics` | Metrics for a user list license. |
| `UserListLicensePricing` | Pricing information for a user list license. |
| `UserProperties` | Advertiser-assessed user properties. |
| `UserProperty` | A single user property. |
| `WarningCount` | Warning count for a given warning reason. |
| `WarningInfo` | Warning counts for each type of warning. |

### Enums

| Enum | Description |
|------|-------------|
| `EventSource` | The source of the event. |
| `GcpWrappedKeyInfo.KeyType` | The type of algorithm used to encrypt the data (GCP). |
| `Gender` | Demographic gender values. |
| `IngestedUserListInfo.UploadKeyType` | The type of key used to upload user list data. |
| `MatchRateRange` | Match rate range for user list uploads. |
| `MobileIdInfo.KeySpace` | The key space for a mobile ID. |
| `PartnerAudienceInfo.PartnerAudienceSource` | The source of a partner audience. |
| `ProcessingErrorReason` | Reasons for processing errors. |
| `ProcessingWarningReason` | Reasons for processing warnings. |
| `Product` | *(Deprecated)* Google product types. |
| `ProductAccount.AccountType` | Types of product accounts. |
| `PseudonymousIdInfo.SyncStatus` | Sync status for pseudonymous IDs. |
| `RequestStatusPerDestination.DataType` | Data types for request status tracking. |
| `RequestStatusPerDestination.RequestStatus` | The status of a request (e.g., success, processing, failed, partial success). |
| `RetrieveInsightsResponse.MarketingDataInsight.AudienceInsightsDimension` | Dimensions for audience insights. |
| `TermsOfServiceStatus` | Status of terms of service acceptance. |
| `UserList.AccessReason` | The reason for user list access. |
| `UserList.AccessStatus` | Access status for a user list. |
| `UserList.ClosingReason` | The reason a user list was closed. |
| `UserList.MembershipStatus` | Membership status of a user list. |
| `UserListGlobalLicenseType` | Type of a user list global license. |
| `UserListLicenseClientAccountType` | The client account type for a user list license. |
| `UserListLicensePricing.UserListPricingBuyerApprovalState` | Buyer approval state for user list pricing. |
| `UserListLicensePricing.UserListPricingCostType` | The cost type for user list pricing. |
| `UserListLicenseStatus` | Status of a user list license. |

---

## REST API Resources

The Data Manager API also exposes a REST interface. REST resources mirror the RPC service structure:

| Resource | Methods |
|----------|---------|
| `accountTypes.accounts.insights` | `retrieve` |
| `accountTypes.accounts.partnerLinks` | `create`, `delete`, `search` |
| `accountTypes.accounts.userListDirectLicenses` | `create`, `get`, `list`, `patch` |
| `accountTypes.accounts.userListGlobalLicenses` | `create`, `get`, `list`, `patch` |
| `accountTypes.accounts.userListGlobalLicenses.userListGlobalLicenseCustomerInfos` | `list` |
| `accountTypes.accounts.userLists` | `create`, `delete`, `get`, `list`, `patch` |
| `audienceMembers` | `ingest`, `remove` |
| `events` | `ingest` |
| `requestStatus` | `retrieve` |

---

## Related Resources

- [Data Manager API Home](https://developers.google.com/data-manager/api)
- [Quickstart Guide](https://developers.google.com/data-manager/api/get-started/quickstart)
- [Set Up API Access](https://developers.google.com/data-manager/api/get-started/set-up-access)
- [Limits and Quotas](https://developers.google.com/data-manager/api/devguides/limits)
- [Release Notes](https://developers.google.com/data-manager/api/reference)
- [Google Analytics Recommended Events](https://developers.google.com/data-manager/api/reference/analytics/recommended-events)
- [Package google.rpc](https://developers.google.com/data-manager/api/reference/rpc/google.rpc)
- [Terms of Service](https://developers.google.com/data-manager/api/devguides/terms)

---

*Generated from: https://developers.google.com/data-manager/api/reference/rpc/google.ads.datamanager.v1*
